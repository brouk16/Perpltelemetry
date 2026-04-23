import WebSocket from "ws";
import { db, oiSnapshotsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { KNOWN_MARKETS } from "./markets";

const API_URL = process.env["PERPL_API_URL"] ?? "https://app.perpl.xyz/api";
const WS_URL = process.env["PERPL_WS_URL"] ?? "wss://app.perpl.xyz";
const CHAIN_ID = Number(process.env["PERPL_CHAIN_ID"] ?? 143);
const SNAPSHOT_INTERVAL_MS = 60_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

interface MarketDecimals {
  priceDecimals: number;
  sizeDecimals: number;
}

interface MarketLatest {
  oiSize: number;
  markPriceRaw: number;
  atMs: number;
}

const decimalsByMarket = new Map<number, MarketDecimals>();
const latestByMarket = new Map<number, MarketLatest>();

interface LatestOi {
  perpId: number;
  symbol: string;
  oiUsd: number;
  markPrice: number;
  atMs: number;
}

export function getLatestOiSnapshot(): {
  totalUsd: number;
  atMs: number;
  perMarket: LatestOi[];
} {
  let totalUsd = 0;
  let atMs = 0;
  const perMarket: LatestOi[] = [];
  for (const [perpId, info] of latestByMarket.entries()) {
    const decs = decimalsByMarket.get(perpId);
    if (!decs) continue;
    const size = info.oiSize / Math.pow(10, decs.sizeDecimals);
    const price = info.markPriceRaw / Math.pow(10, decs.priceDecimals);
    const usd = size * price;
    totalUsd += usd;
    atMs = Math.max(atMs, info.atMs);
    const meta = KNOWN_MARKETS[perpId];
    perMarket.push({
      perpId,
      symbol: meta?.symbol ?? `PERP${perpId}`,
      oiUsd: usd,
      markPrice: price,
    });
  }
  perMarket.sort((a, b) => b.oiUsd - a.oiUsd);
  return { totalUsd, atMs, perMarket };
}

async function loadContextDecimals(): Promise<void> {
  try {
    const r = await fetch(`${API_URL}/v1/pub/context`);
    if (!r.ok) {
      logger.warn({ status: r.status }, "perpl-oi: context fetch failed");
      return;
    }
    const ctx = (await r.json()) as {
      markets?: Array<{
        id?: number;
        market_id?: number;
        price_decimals?: number;
        size_decimals?: number;
        priceDecimals?: number;
        sizeDecimals?: number;
      }>;
    };
    for (const m of ctx.markets ?? []) {
      const id = m.id ?? m.market_id;
      const pd = m.price_decimals ?? m.priceDecimals;
      const sd = m.size_decimals ?? m.sizeDecimals;
      if (typeof id === "number" && typeof pd === "number" && typeof sd === "number") {
        decimalsByMarket.set(id, { priceDecimals: pd, sizeDecimals: sd });
      }
    }
    logger.info(
      { markets: decimalsByMarket.size },
      "perpl-oi: loaded market decimals from context",
    );
  } catch (err) {
    logger.warn({ err }, "perpl-oi: failed to load context");
  }
}

async function persistSnapshot(): Promise<void> {
  const snap = getLatestOiSnapshot();
  if (snap.perMarket.length === 0) return;
  const ts = Date.now();
  try {
    await db
      .insert(oiSnapshotsTable)
      .values(
        snap.perMarket.map((m) => ({
          timestampMs: ts,
          perpId: m.perpId,
          oiUsd: m.oiUsd,
          markPrice: m.markPrice,
        })),
      )
      .onConflictDoNothing();
  } catch (err) {
    logger.warn({ err }, "perpl-oi: snapshot persist failed");
  }
}

function handleMessage(raw: WebSocket.RawData): void {
  let msg: unknown;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;
  const m = msg as { mt?: number; d?: Record<string, unknown> };
  // mt:9 = MarketStateUpdate, mt:8 = MarketConfigUpdate
  if (m.mt === 8 && m.d && typeof m.d === "object") {
    for (const [k, v] of Object.entries(m.d)) {
      if (!v || typeof v !== "object") continue;
      const cfg = v as { pd?: number; sd?: number; price_decimals?: number; size_decimals?: number };
      const pd = cfg.pd ?? cfg.price_decimals;
      const sd = cfg.sd ?? cfg.size_decimals;
      const id = Number(k);
      if (Number.isFinite(id) && typeof pd === "number" && typeof sd === "number") {
        decimalsByMarket.set(id, { priceDecimals: pd, sizeDecimals: sd });
      }
    }
  }
  if (m.mt === 9 && m.d && typeof m.d === "object") {
    const now = Date.now();
    for (const [k, v] of Object.entries(m.d)) {
      if (!v || typeof v !== "object") continue;
      const st = v as { oi?: number; mrk?: number; lst?: number };
      const id = Number(k);
      if (!Number.isFinite(id)) continue;
      if (typeof st.oi !== "number") continue;
      const mark = typeof st.mrk === "number" ? st.mrk : typeof st.lst === "number" ? st.lst : 0;
      latestByMarket.set(id, { oiSize: st.oi, markPriceRaw: mark, atMs: now });
    }
  }
}

let reconnectDelayMs = RECONNECT_BASE_MS;

function connect(): void {
  const url = `${WS_URL}/ws/v1/market-data`;
  const ws = new WebSocket(url);
  let openHandled = false;

  ws.on("open", () => {
    openHandled = true;
    reconnectDelayMs = RECONNECT_BASE_MS;
    logger.info({ url }, "perpl-oi: ws connected");
    ws.send(
      JSON.stringify({
        mt: 5,
        subs: [
          { stream: `heartbeat@${CHAIN_ID}`, subscribe: true },
          { stream: `market-config@${CHAIN_ID}`, subscribe: true },
          { stream: `market-state@${CHAIN_ID}`, subscribe: true },
        ],
      }),
    );
  });

  ws.on("message", handleMessage);

  ws.on("error", (err) => {
    logger.warn({ err: String(err) }, "perpl-oi: ws error");
  });

  ws.on("close", () => {
    const wasOpen = openHandled;
    if (!wasOpen) {
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
    }
    logger.info({ delayMs: reconnectDelayMs }, "perpl-oi: ws closed, reconnecting");
    setTimeout(connect, reconnectDelayMs);
  });
}

export async function startOiSubscriber(): Promise<void> {
  await loadContextDecimals();
  connect();
  setInterval(() => {
    void persistSnapshot();
  }, SNAPSHOT_INTERVAL_MS);
}
