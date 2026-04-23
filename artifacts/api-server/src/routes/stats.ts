import { Router, type IRouter } from "express";
import { and, gte, eq, sql } from "drizzle-orm";
import {
  db,
  indexerStateTable,
  blockBucketsTable,
  marketBucketsTable,
  accountBucketsTable,
  oiSnapshotsTable,
  accountWalletsTable,
} from "@workspace/db";
import {
  GetStatsResponse,
  GetMarketStatsResponse,
  GetVolumeTimeseriesResponse,
  GetVolumeBreakdownResponse,
  GetLeaderboardResponse,
  GetOiHistoryResponse,
  GetWalletsResponse,
  ClaimWalletResponse,
} from "@workspace/api-zod";
import {
  getChainHeadCached,
  getContractFloorCached,
} from "../perpl/indexer";
import { getLatestOiSnapshot } from "../perpl/oi";
import { KNOWN_MARKETS } from "../perpl/markets";

const router: IRouter = Router();
const STATE_ID = "perpl";

let tvlCache: { usd: number; ts: number } = { usd: 0, ts: 0 };
const TVL_CACHE_TTL_MS = 5 * 60_000; // 5 minutes — DeFiLlama updates daily

async function fetchTvlUsd(): Promise<number> {
  const now = Date.now();
  if (now - tvlCache.ts < TVL_CACHE_TTL_MS) return tvlCache.usd;
  try {
    const res = await fetch("https://api.llama.fi/tvl/perpl", {
      signal: AbortSignal.timeout(6000),
    });
    const text = await res.text();
    const val = Number(text.trim());
    if (Number.isFinite(val) && val > 0) {
      tvlCache = { usd: val, ts: now };
    }
  } catch { /* keep cached */ }
  return tvlCache.usd;
}

// External baseline anchor (DefiLlama publishes cumulative perp volume on
// https://defillama.com/protocol/perpl but their API requires a paid plan, so we
// snapshot the figure manually). Captured 2026-04-22 from the DefiLlama UI:
// Cumulative Perp Volume = $41.94M.  Our own indexer adds delta on top of this
// for any block timestamps strictly AFTER BASELINE_AT_MS.  Update both numbers
// together when refreshing the snapshot.
const BASELINE_VOLUME_USD = Number(
  process.env["PERPL_BASELINE_VOLUME_USD"] ?? 41_940_000,
);
const BASELINE_AT_MS = Number(
  process.env["PERPL_BASELINE_AT_MS"] ?? 1776888719_000,
);

router.get("/stats", async (_req, res) => {
  const stateRow = (
    await db
      .select()
      .from(indexerStateTable)
      .where(eq(indexerStateTable.id, STATE_ID))
      .limit(1)
  )[0];

  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const dailyAgg = (
    await db
      .select({
        v: sql<number>`COALESCE(SUM(${blockBucketsTable.volumeUsd}), 0)`,
        f: sql<number>`COALESCE(SUM(${blockBucketsTable.feesUsd}), 0)`,
        c: sql<number>`COALESCE(SUM(${blockBucketsTable.tradeCount}), 0)`,
      })
      .from(blockBucketsTable)
      .where(gte(blockBucketsTable.timestampMs, sinceMs))
  )[0];

  // Volume our indexer has captured strictly AFTER the external baseline snapshot.
  const sinceBaselineAgg = (
    await db
      .select({
        v: sql<number>`COALESCE(SUM(${blockBucketsTable.volumeUsd}), 0)`,
      })
      .from(blockBucketsTable)
      .where(gte(blockBucketsTable.timestampMs, BASELINE_AT_MS))
  )[0];
  const localDeltaSinceBaseline = Number(sinceBaselineAgg?.v ?? 0);
  const totalVolumeUsd = BASELINE_VOLUME_USD + localDeltaSinceBaseline;

  const chainHead = await getChainHeadCached();
  const contractStart = await getContractFloorCached();

  const indexedRange =
    stateRow != null
      ? Math.max(0, stateRow.forwardHead - stateRow.backwardTail)
      : 0;
  const totalRange = chainHead > 0 ? Math.max(1, chainHead - contractStart) : 1;
  const indexedFraction = Math.max(
    0,
    Math.min(1, indexedRange / totalRange),
  );

  const usersAgg = (
    await db
      .select({
        n: sql<number>`MAX(${accountBucketsTable.accountId})`,
      })
      .from(accountBucketsTable)
  )[0];
  const totalUsers = Number(usersAgg?.n ?? 0);

  const tvlUsd = await fetchTvlUsd();

  const latestOiTsRow = (
    await db
      .select({ maxTs: sql<number>`MAX(${oiSnapshotsTable.timestampMs})` })
      .from(oiSnapshotsTable)
  )[0];
  const latestOiTs = Number(latestOiTsRow?.maxTs ?? 0);
  const oiRows =
    latestOiTs > 0
      ? await db
          .select()
          .from(oiSnapshotsTable)
          .where(eq(oiSnapshotsTable.timestampMs, latestOiTs))
      : [];
  const oi = {
    totalUsd: oiRows.reduce((sum, r) => sum + Number(r.oiUsd), 0),
    atMs: latestOiTs,
  };

  const data = GetStatsResponse.parse({
    dailyVolumeUsd: Number(dailyAgg?.v ?? 0),
    totalVolumeUsd,
    dailyFeesUsd: Number(dailyAgg?.f ?? 0),
    totalFeesUsd: Number(stateRow?.totalFeesUsd ?? 0),
    dailyTradeCount: Number(dailyAgg?.c ?? 0),
    totalTradeCount: Number(stateRow?.totalTradeCount ?? 0),
    lastUpdatedMs: Number(stateRow?.lastUpdatedMs ?? Date.now()),
    indexerHeadBlock: Number(stateRow?.forwardHead ?? 0),
    indexerTailBlock: Number(stateRow?.backwardTail ?? 0),
    chainHeadBlock: chainHead,
    contractStartBlock: contractStart,
    indexedFraction,
    baselineVolumeUsd: BASELINE_VOLUME_USD,
    baselineAtMs: BASELINE_AT_MS,
    indexedDeltaVolumeUsd: localDeltaSinceBaseline,
    totalUsers,
    tvlUsd,
    openInterestUsd: oi.totalUsd,
    openInterestAtMs: oi.atMs,
  });
  res.json(data);
});

router.get("/stats/oi-history", async (_req, res) => {
  const now = Date.now();
  const sinceMs = now - 24 * 60 * 60 * 1000;

  const rows = await db
    .select({
      timestampMs: oiSnapshotsTable.timestampMs,
      perpId: oiSnapshotsTable.perpId,
      oiUsd: oiSnapshotsTable.oiUsd,
    })
    .from(oiSnapshotsTable)
    .where(gte(oiSnapshotsTable.timestampMs, sinceMs));

  const HOUR = 60 * 60 * 1000;
  const buckets = new Map<number, number>();
  for (let i = 23; i >= 0; i--) {
    const slot = Math.floor((now - i * HOUR) / HOUR) * HOUR;
    buckets.set(slot, 0);
  }
  const allSlots = Array.from(buckets.keys()).sort((a, b) => a - b);

  // Aggregate rows: sum per timestamp, then MAX per hour bucket (total OI)
  const perTs = new Map<number, number>();
  // Per-market: perpId -> slot -> maxOiUsd
  const mktBuckets = new Map<number, Map<number, number>>();

  for (const r of rows) {
    const ts = Number(r.timestampMs);
    const oiUsd = Number(r.oiUsd);
    const pid = r.perpId;
    const slot = Math.floor(ts / HOUR) * HOUR;
    if (!buckets.has(slot)) continue;

    perTs.set(ts, (perTs.get(ts) ?? 0) + oiUsd);

    if (!mktBuckets.has(pid)) mktBuckets.set(pid, new Map());
    const mb = mktBuckets.get(pid)!;
    mb.set(slot, Math.max(mb.get(slot) ?? 0, oiUsd));
  }

  for (const [ts, sumUsd] of perTs) {
    const slot = Math.floor(ts / HOUR) * HOUR;
    if (!buckets.has(slot)) continue;
    buckets.set(slot, Math.max(buckets.get(slot)!, sumUsd));
  }

  const points = allSlots.map((slot) => ({ timestampMs: slot, oiUsd: buckets.get(slot)! }));

  const live = getLatestOiSnapshot();

  // Seed the last bucket with live value if no DB data yet
  if (live.totalUsd > 0 && points.length > 0) {
    const last = points[points.length - 1]!;
    if (last.oiUsd === 0) last.oiUsd = live.totalUsd;
  }

  // Build per-market history — include all markets that have any data
  const perpIds = new Set<number>([...mktBuckets.keys(), ...live.perMarket.map((m) => m.perpId)]);
  const perMarketHistory = Array.from(perpIds)
    .map((perpId) => {
      const mb = mktBuckets.get(perpId);
      const symbol = KNOWN_MARKETS[perpId]?.symbol ?? `PERP${perpId}`;
      const pts = allSlots.map((slot) => ({
        timestampMs: slot,
        oiUsd: mb?.get(slot) ?? 0,
      }));
      // Seed last bucket from live if zero
      const liveM = live.perMarket.find((m) => m.perpId === perpId);
      if (liveM && pts.length > 0 && pts[pts.length - 1]!.oiUsd === 0) {
        pts[pts.length - 1]!.oiUsd = liveM.oiUsd;
      }
      return { perpId, symbol, points: pts };
    })
    .filter((m) => m.points.some((p) => p.oiUsd > 0));

  const data = GetOiHistoryResponse.parse({
    points,
    perMarket: live.perMarket,
    perMarketHistory,
  });
  res.json(data);
});

router.get("/stats/volume-breakdown", async (_req, res) => {
  const now = Date.now();
  const sinceMs = now - 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;

  const rows = await db
    .select({
      perpId: marketBucketsTable.perpId,
      timestampMs: marketBucketsTable.timestampMs,
      volumeUsd: marketBucketsTable.volumeUsd,
      tradeCount: marketBucketsTable.tradeCount,
    })
    .from(marketBucketsTable)
    .where(gte(marketBucketsTable.timestampMs, sinceMs));

  // Seed hourly slots for the past 24h
  const allSlots: number[] = [];
  for (let i = 23; i >= 0; i--) {
    allSlots.push(Math.floor((now - i * HOUR) / HOUR) * HOUR);
  }
  const slotSet = new Set(allSlots);

  // Aggregate per-market totals + hourly buckets
  const totals = new Map<number, { volumeUsd: number; tradeCount: number }>();
  const mktBuckets = new Map<number, Map<number, number>>();

  for (const r of rows) {
    const pid = r.perpId;
    const slot = Math.floor(Number(r.timestampMs) / HOUR) * HOUR;
    if (!slotSet.has(slot)) continue;

    const cur = totals.get(pid) ?? { volumeUsd: 0, tradeCount: 0 };
    cur.volumeUsd += Number(r.volumeUsd);
    cur.tradeCount += Number(r.tradeCount);
    totals.set(pid, cur);

    if (!mktBuckets.has(pid)) mktBuckets.set(pid, new Map());
    const mb = mktBuckets.get(pid)!;
    mb.set(slot, (mb.get(slot) ?? 0) + Number(r.volumeUsd));
  }

  // Always include known markets
  for (const m of Object.values(KNOWN_MARKETS)) {
    if (!totals.has(m.perpId)) totals.set(m.perpId, { volumeUsd: 0, tradeCount: 0 });
  }

  const perMarket = Array.from(totals.entries())
    .map(([perpId, t]) => ({
      perpId,
      symbol: KNOWN_MARKETS[perpId]?.symbol ?? `PERP${perpId}`,
      volumeUsd24h: t.volumeUsd,
      tradeCount24h: t.tradeCount,
    }))
    .sort((a, b) => b.volumeUsd24h - a.volumeUsd24h);

  const perMarketHistory = Array.from(mktBuckets.entries())
    .map(([perpId, mb]) => ({
      perpId,
      symbol: KNOWN_MARKETS[perpId]?.symbol ?? `PERP${perpId}`,
      points: allSlots.map((slot) => ({ timestampMs: slot, volumeUsd: mb.get(slot) ?? 0 })),
    }))
    .filter((m) => m.points.some((p) => p.volumeUsd > 0));

  const data = GetVolumeBreakdownResponse.parse({ perMarket, perMarketHistory });
  res.json(data);
});

router.get("/stats/markets", async (_req, res) => {
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const rows = await db
    .select({
      perpId: marketBucketsTable.perpId,
      v: sql<number>`COALESCE(SUM(${marketBucketsTable.volumeUsd}), 0)`,
      c: sql<number>`COALESCE(SUM(${marketBucketsTable.tradeCount}), 0)`,
    })
    .from(marketBucketsTable)
    .where(gte(marketBucketsTable.timestampMs, sinceMs))
    .groupBy(marketBucketsTable.perpId);

  const seen = new Map<number, { volumeUsd: number; tradeCount: number }>();
  for (const r of rows) {
    seen.set(r.perpId, {
      volumeUsd: Number(r.v),
      tradeCount: Number(r.c),
    });
  }
  // Always include known markets so the UI has stable rows even with no trades yet.
  for (const m of Object.values(KNOWN_MARKETS)) {
    if (!seen.has(m.perpId)) {
      seen.set(m.perpId, { volumeUsd: 0, tradeCount: 0 });
    }
  }

  const markets = Array.from(seen.entries())
    .map(([perpId, m]) => ({
      perpId,
      symbol: KNOWN_MARKETS[perpId]?.symbol ?? `PERP${perpId}`,
      dailyVolumeUsd: m.volumeUsd,
      dailyTradeCount: m.tradeCount,
    }))
    .sort((a, b) => b.dailyVolumeUsd - a.dailyVolumeUsd);

  const data = GetMarketStatsResponse.parse({ markets });
  res.json(data);
});

router.get("/stats/timeseries", async (_req, res) => {
  const now = Date.now();
  const sinceMs = now - 24 * 60 * 60 * 1000;
  const rows = await db
    .select({
      timestampMs: blockBucketsTable.timestampMs,
      volumeUsd: blockBucketsTable.volumeUsd,
      tradeCount: blockBucketsTable.tradeCount,
    })
    .from(blockBucketsTable)
    .where(
      and(
        gte(blockBucketsTable.timestampMs, sinceMs),
      ),
    );

  const HOUR = 60 * 60 * 1000;
  const buckets = new Map<
    number,
    { volumeUsd: number; tradeCount: number }
  >();
  // Seed empty hourly slots for the last 24h.
  for (let i = 23; i >= 0; i--) {
    const slot = Math.floor((now - i * HOUR) / HOUR) * HOUR;
    buckets.set(slot, { volumeUsd: 0, tradeCount: 0 });
  }
  for (const r of rows) {
    const slot = Math.floor(Number(r.timestampMs) / HOUR) * HOUR;
    if (!buckets.has(slot)) continue;
    const b = buckets.get(slot)!;
    b.volumeUsd += Number(r.volumeUsd);
    b.tradeCount += Number(r.tradeCount);
  }

  const points = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([timestampMs, v]) => ({
      timestampMs,
      volumeUsd: v.volumeUsd,
      tradeCount: v.tradeCount,
    }));

  const data = GetVolumeTimeseriesResponse.parse({ points });
  res.json(data);
});

router.get("/stats/leaderboard", async (req, res) => {
  const period = req.query["period"] === "all" ? "all" : "day";
  const metric = req.query["metric"] === "pnl" ? "pnl" : "volume";
  const limitRaw = Number(req.query["limit"] ?? 20);
  const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 20));

  const orderExpr =
    metric === "pnl"
      ? sql`SUM(${accountBucketsTable.pnlUsd}) DESC`
      : sql`SUM(${accountBucketsTable.volumeUsd}) DESC`;

  const baseQuery = db
    .select({
      accountId: accountBucketsTable.accountId,
      v: sql<number>`COALESCE(SUM(${accountBucketsTable.volumeUsd}), 0)`,
      f: sql<number>`COALESCE(SUM(${accountBucketsTable.feesUsd}), 0)`,
      p: sql<number>`COALESCE(SUM(${accountBucketsTable.pnlUsd}), 0)`,
      c: sql<number>`COALESCE(SUM(${accountBucketsTable.tradeCount}), 0)`,
    })
    .from(accountBucketsTable)
    .groupBy(accountBucketsTable.accountId)
    .orderBy(orderExpr)
    .limit(limit);

  const rows =
    period === "day"
      ? await baseQuery.where(
          gte(accountBucketsTable.timestampMs, Date.now() - 24 * 60 * 60 * 1000),
        )
      : await baseQuery;

  // Load all wallet mappings and build a lookup map
  const walletRows = await db.select().from(accountWalletsTable);
  const walletMap = new Map(walletRows.map((w) => [w.accountId, w]));

  const entries = rows.map((r, i) => {
    const wallet = walletMap.get(Number(r.accountId));
    return {
      rank: i + 1,
      accountId: String(r.accountId),
      walletAddress: wallet?.walletAddress ?? null,
      label: wallet?.label ?? null,
      volumeUsd: Number(r.v),
      feesUsd: Number(r.f),
      pnlUsd: Number(r.p),
      tradeCount: Number(r.c),
    };
  });

  const data = GetLeaderboardResponse.parse({ period, entries });
  res.json(data);
});

router.get("/stats/wallets", async (_req, res) => {
  const rows = await db.select().from(accountWalletsTable);
  const wallets = rows.map((r) => ({
    accountId: String(r.accountId),
    walletAddress: r.walletAddress,
    label: r.label ?? null,
    claimedAtMs: r.claimedAtMs,
  }));
  const data = GetWalletsResponse.parse({ wallets });
  res.json(data);
});

router.post("/stats/wallets", async (req, res) => {
  const body = req.body as { accountId?: unknown; walletAddress?: unknown; label?: unknown };
  const accountIdRaw = String(body.accountId ?? "").trim();
  const walletAddress = String(body.walletAddress ?? "").trim().toLowerCase();
  const label = body.label ? String(body.label).slice(0, 64).trim() : null;

  const accountIdNum = Number(accountIdRaw);
  if (!Number.isFinite(accountIdNum) || accountIdNum <= 0) {
    res.status(400).json({ error: "Invalid accountId" });
    return;
  }
  if (!/^0x[0-9a-f]{40}$/.test(walletAddress)) {
    res.status(400).json({ error: "Invalid walletAddress — must be 0x-prefixed 20-byte hex" });
    return;
  }
  // Verify accountId exists in our data
  const exists = await db
    .select({ accountId: accountBucketsTable.accountId })
    .from(accountBucketsTable)
    .where(eq(accountBucketsTable.accountId, accountIdNum))
    .limit(1);
  if (exists.length === 0) {
    res.status(400).json({ error: "accountId not found in indexed data" });
    return;
  }

  await db
    .insert(accountWalletsTable)
    .values({
      accountId: accountIdNum,
      walletAddress,
      label: label ?? undefined,
      claimedAtMs: Date.now(),
    })
    .onConflictDoUpdate({
      target: accountWalletsTable.accountId,
      set: { walletAddress, label: label ?? undefined, claimedAtMs: Date.now() },
    });

  const row = (
    await db
      .select()
      .from(accountWalletsTable)
      .where(eq(accountWalletsTable.accountId, accountIdNum))
      .limit(1)
  )[0]!;

  const data = ClaimWalletResponse.parse({
    accountId: String(row.accountId),
    walletAddress: row.walletAddress,
    label: row.label ?? null,
    claimedAtMs: row.claimedAtMs,
  });
  res.json(data);
});

export default router;
