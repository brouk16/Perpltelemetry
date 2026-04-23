import { Router, type IRouter } from "express";
import { and, gte, eq, sql } from "drizzle-orm";
import {
  db,
  indexerStateTable,
  blockBucketsTable,
  marketBucketsTable,
  accountBucketsTable,
  oiSnapshotsTable,
} from "@workspace/db";
import {
  GetStatsResponse,
  GetMarketStatsResponse,
  GetVolumeTimeseriesResponse,
  GetLeaderboardResponse,
  GetOiHistoryResponse,
} from "@workspace/api-zod";
import {
  getChainHeadCached,
  getContractFloorCached,
} from "../perpl/indexer";
import { KNOWN_MARKETS } from "../perpl/markets";
import { getLatestOiSnapshot } from "../perpl/oi";

const router: IRouter = Router();
const STATE_ID = "perpl";

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
        n: sql<number>`COUNT(DISTINCT ${accountBucketsTable.accountId})`,
      })
      .from(accountBucketsTable)
  )[0];
  const totalUsers = Number(usersAgg?.n ?? 0);

  const oi = getLatestOiSnapshot();

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
  // Sum per timestamp first (each ts has one row per market) then take MAX per
  // hour bucket so the chart shows a representative OI level per hour.
  const perTs = new Map<number, number>();
  for (const r of rows) {
    const ts = Number(r.timestampMs);
    perTs.set(ts, (perTs.get(ts) ?? 0) + Number(r.oiUsd));
  }
  for (const [ts, sumUsd] of perTs) {
    const slot = Math.floor(ts / HOUR) * HOUR;
    if (!buckets.has(slot)) continue;
    buckets.set(slot, Math.max(buckets.get(slot)!, sumUsd));
  }

  const points = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([timestampMs, oiUsd]) => ({ timestampMs, oiUsd }));

  // If we have no historical snapshots yet (first boot), seed the most recent
  // bucket with the live in-memory snapshot so the chart isn't empty.
  const live = getLatestOiSnapshot();
  if (live.totalUsd > 0 && points[points.length - 1]) {
    const last = points[points.length - 1]!;
    if (last.oiUsd === 0) last.oiUsd = live.totalUsd;
  }

  const data = GetOiHistoryResponse.parse({
    points,
    perMarket: live.perMarket,
  });
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

  const entries = rows.map((r, i) => ({
    rank: i + 1,
    accountId: String(r.accountId),
    volumeUsd: Number(r.v),
    feesUsd: Number(r.f),
    pnlUsd: Number(r.p),
    tradeCount: Number(r.c),
  }));

  const data = GetLeaderboardResponse.parse({ period, entries });
  res.json(data);
});

export default router;
