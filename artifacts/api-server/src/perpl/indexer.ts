import {
  createPublicClient,
  http,
  parseAbiItem,
  defineChain,
  decodeEventLog,
  type Log,
} from "viem";
import { eq, sql } from "drizzle-orm";
import {
  db,
  indexerStateTable,
  blockBucketsTable,
  marketBucketsTable,
  accountBucketsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  KNOWN_MARKETS,
  PERPL_EXCHANGE_ADDRESS,
  type Market,
} from "./markets";

const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://monad.drpc.org"] } },
});

// dRPC free tier permits up to ~1,000-block ranges on Monad.
const MAX_RANGE = 1_000;
const FORWARD_INTERVAL_MS = 4_000;
const BACKWARD_INTERVAL_MS = 200;
const BACKWARD_PARALLELISM = 4;
const STATE_ID = "perpl";

// Approximate Monad mainnet block matching contract genesis (Feb 12, 2026).
// Used only as a backstop floor for the backward scan. Refined dynamically.
const CONTRACT_FLOOR_BLOCK = 17_000_000;

const client = createPublicClient({
  chain: monadMainnet,
  transport: http("https://monad.drpc.org", { timeout: 20_000, retryCount: 2 }),
});

const makerEvent = parseAbiItem(
  "event MakerOrderFilled(uint256 perpId, uint256 accountId, uint256 orderId, uint256 pricePNS, uint256 lotLNS, uint256 feeCNS, uint256 lockedBalanceCNS, int256 amountCNS, uint256 balanceCNS)",
);

const getPerpetualInfoAbi = [
  {
    type: "function",
    name: "getPerpetualInfo",
    stateMutability: "view",
    inputs: [{ name: "perpId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "priceDecimals", type: "uint256" },
          { name: "lotDecimals", type: "uint256" },
          { name: "linkFeedId", type: "bytes32" },
          { name: "priceTolPer100K", type: "uint256" },
          { name: "marginTol", type: "uint256" },
          { name: "marginTolDecimals", type: "uint256" },
          { name: "refPriceMaxAgeSec", type: "uint256" },
          { name: "positionBalanceCNS", type: "uint256" },
          { name: "insuranceBalanceCNS", type: "uint256" },
          { name: "markPNS", type: "uint256" },
          { name: "markTimestamp", type: "uint256" },
          { name: "lastPNS", type: "uint256" },
          { name: "lastTimestamp", type: "uint256" },
          { name: "oraclePNS", type: "uint256" },
          { name: "oracleTimestampSec", type: "uint256" },
          { name: "longOpenInterestLNS", type: "uint256" },
          { name: "shortOpenInterestLNS", type: "uint256" },
        ],
      },
    ],
  },
] as const;

type ChunkResult = {
  fromBlock: number;
  toBlock: number;
  timestampMs: number;
  totalVolumeUsd: number;
  totalFeesUsd: number;
  totalTradeCount: number;
  perMarket: Map<number, { volumeUsd: number; tradeCount: number }>;
  perAccount: Map<
    number,
    { volumeUsd: number; feesUsd: number; pnlUsd: number; tradeCount: number }
  >;
};

const marketCache = new Map<number, Market>(
  Object.values(KNOWN_MARKETS).map((m) => [m.perpId, m]),
);

async function ensureMarket(perpId: number): Promise<Market | null> {
  const existing = marketCache.get(perpId);
  if (existing) return existing;
  try {
    const info = (await client.readContract({
      address: PERPL_EXCHANGE_ADDRESS,
      abi: getPerpetualInfoAbi,
      functionName: "getPerpetualInfo",
      args: [BigInt(perpId)],
    })) as {
      symbol: string;
      priceDecimals: bigint;
      lotDecimals: bigint;
    };
    const market: Market = {
      perpId,
      symbol: info.symbol || `PERP${perpId}`,
      priceDecimals: Number(info.priceDecimals),
      lotDecimals: Number(info.lotDecimals),
    };
    marketCache.set(perpId, market);
    return market;
  } catch (err) {
    logger.warn({ err, perpId }, "failed to load market info");
    return null;
  }
}

async function processLogs(
  logs: Log[],
  fromBlock: number,
  toBlock: number,
): Promise<ChunkResult> {
  const result: ChunkResult = {
    fromBlock,
    toBlock,
    timestampMs: Date.now(),
    totalVolumeUsd: 0,
    totalFeesUsd: 0,
    totalTradeCount: 0,
    perMarket: new Map(),
    perAccount: new Map(),
  };

  // Use the latest log's block timestamp if we have logs, else fall back to now.
  if (logs.length > 0) {
    try {
      const lastLog = logs[logs.length - 1];
      if (lastLog && lastLog.blockNumber !== null) {
        const block = await client.getBlock({
          blockNumber: lastLog.blockNumber,
        });
        result.timestampMs = Number(block.timestamp) * 1000;
      }
    } catch {
      /* keep Date.now() */
    }
  }

  for (const raw of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: [makerEvent],
        data: raw.data,
        topics: raw.topics,
      });
    } catch {
      continue;
    }
    const args = decoded.args as unknown as {
      perpId: bigint;
      accountId: bigint;
      pricePNS: bigint;
      lotLNS: bigint;
      feeCNS: bigint;
      amountCNS: bigint;
    };
    const perpId = Number(args.perpId);
    const accountId = Number(args.accountId);
    // amountCNS is signed and represents realized PnL on this fill (CNS = AUSD, 6 decimals).
    const pnl = Number(args.amountCNS) / 1e6;
    const market = await ensureMarket(perpId);
    if (!market) continue;
    const price = Number(args.pricePNS) / 10 ** market.priceDecimals;
    const lots = Number(args.lotLNS) / 10 ** market.lotDecimals;
    const notional = price * lots;
    const fee = Number(args.feeCNS) / 1e6; // AUSD has 6 decimals, 1:1 USD
    if (!Number.isFinite(notional) || !Number.isFinite(fee)) continue;
    result.totalVolumeUsd += notional;
    result.totalFeesUsd += fee;
    result.totalTradeCount += 1;
    const m = result.perMarket.get(perpId) ?? { volumeUsd: 0, tradeCount: 0 };
    m.volumeUsd += notional;
    m.tradeCount += 1;
    result.perMarket.set(perpId, m);
    if (Number.isFinite(accountId)) {
      const a = result.perAccount.get(accountId) ?? {
        volumeUsd: 0,
        feesUsd: 0,
        pnlUsd: 0,
        tradeCount: 0,
      };
      a.volumeUsd += notional;
      a.feesUsd += fee;
      if (Number.isFinite(pnl)) a.pnlUsd += pnl;
      a.tradeCount += 1;
      result.perAccount.set(accountId, a);
    }
  }

  return result;
}

async function fetchChunk(
  fromBlock: number,
  toBlock: number,
): Promise<ChunkResult> {
  const logs = await client.getLogs({
    address: PERPL_EXCHANGE_ADDRESS,
    event: makerEvent,
    fromBlock: BigInt(fromBlock),
    toBlock: BigInt(toBlock),
  });
  return processLogs(logs as Log[], fromBlock, toBlock);
}

async function persistChunk(chunk: ChunkResult, direction: "forward" | "backward") {
  await db.transaction(async (tx) => {
    await tx
      .insert(blockBucketsTable)
      .values({
        fromBlock: chunk.fromBlock,
        toBlock: chunk.toBlock,
        timestampMs: chunk.timestampMs,
        volumeUsd: chunk.totalVolumeUsd,
        feesUsd: chunk.totalFeesUsd,
        tradeCount: chunk.totalTradeCount,
      })
      .onConflictDoNothing();

    for (const [perpId, m] of chunk.perMarket) {
      await tx
        .insert(marketBucketsTable)
        .values({
          fromBlock: chunk.fromBlock,
          perpId,
          timestampMs: chunk.timestampMs,
          volumeUsd: m.volumeUsd,
          tradeCount: m.tradeCount,
        })
        .onConflictDoNothing();
    }

    if (chunk.perAccount.size > 0) {
      await tx
        .insert(accountBucketsTable)
        .values(
          Array.from(chunk.perAccount, ([accountId, a]) => ({
            fromBlock: chunk.fromBlock,
            accountId,
            timestampMs: chunk.timestampMs,
            volumeUsd: a.volumeUsd,
            feesUsd: a.feesUsd,
            pnlUsd: a.pnlUsd,
            tradeCount: a.tradeCount,
          })),
        )
        .onConflictDoNothing();
    }

    const existing = await tx
      .select()
      .from(indexerStateTable)
      .where(eq(indexerStateTable.id, STATE_ID))
      .limit(1);

    const prev = existing[0];
    if (!prev) return;

    const update: Partial<typeof indexerStateTable.$inferInsert> = {
      totalVolumeUsd: prev.totalVolumeUsd + chunk.totalVolumeUsd,
      totalFeesUsd: prev.totalFeesUsd + chunk.totalFeesUsd,
      totalTradeCount: prev.totalTradeCount + chunk.totalTradeCount,
      lastUpdatedMs: Date.now(),
    };
    if (direction === "forward") {
      update.forwardHead = Math.max(prev.forwardHead, chunk.toBlock);
    } else {
      update.backwardTail = Math.min(prev.backwardTail, chunk.fromBlock);
    }
    await tx
      .update(indexerStateTable)
      .set(update)
      .where(eq(indexerStateTable.id, STATE_ID));
  });
}

async function findContractFirstActiveBlock(headBlock: number): Promise<number> {
  // Use eth_getCode binary search to find the contract deployment block within
  // the floor..head range. Limited to ~30 RPC calls.
  let lo = CONTRACT_FLOOR_BLOCK;
  let hi = headBlock;
  // Quick check: ensure floor has no code (so we know binary search is valid).
  try {
    const code = await client.getBytecode({
      address: PERPL_EXCHANGE_ADDRESS,
      blockNumber: BigInt(lo),
    });
    if (code && code !== "0x") {
      return lo;
    }
  } catch {
    // fall through
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    try {
      const code = await client.getBytecode({
        address: PERPL_EXCHANGE_ADDRESS,
        blockNumber: BigInt(mid),
      });
      if (code && code !== "0x") hi = mid;
      else lo = mid;
    } catch {
      lo = mid; // be conservative on error
    }
  }
  return hi;
}

async function ensureState() {
  const rows = await db
    .select()
    .from(indexerStateTable)
    .where(eq(indexerStateTable.id, STATE_ID))
    .limit(1);
  if (rows.length > 0) return rows[0]!;

  const headBlock = Number(await client.getBlockNumber());
  // Start the forward scan from a recent point so traders see fresh 24h volume
  // quickly. Backward scan will fill in the history toward the contract genesis.
  const forwardHead = Math.max(headBlock - MAX_RANGE * 2, CONTRACT_FLOOR_BLOCK);
  const backwardTail = forwardHead;

  await db.insert(indexerStateTable).values({
    id: STATE_ID,
    forwardHead,
    backwardTail,
    totalVolumeUsd: 0,
    totalFeesUsd: 0,
    totalTradeCount: 0,
    lastUpdatedMs: Date.now(),
  });

  // Discover the contract's true first-active block in the background; cache
  // as a separate row with id "perpl_floor" for use as the backward floor.
  void (async () => {
    try {
      const firstActive = await findContractFirstActiveBlock(headBlock);
      await db
        .insert(indexerStateTable)
        .values({
          id: "perpl_floor",
          forwardHead: firstActive,
          backwardTail: firstActive,
          totalVolumeUsd: 0,
          totalFeesUsd: 0,
          totalTradeCount: 0,
          lastUpdatedMs: Date.now(),
        })
        .onConflictDoNothing();
      logger.info({ firstActive }, "Perpl contract first-active block resolved");
    } catch (err) {
      logger.warn({ err }, "Failed to resolve contract first block");
    }
  })();

  return (
    await db
      .select()
      .from(indexerStateTable)
      .where(eq(indexerStateTable.id, STATE_ID))
      .limit(1)
  )[0]!;
}

async function getFloor(): Promise<number> {
  const rows = await db
    .select()
    .from(indexerStateTable)
    .where(eq(indexerStateTable.id, "perpl_floor"))
    .limit(1);
  return rows[0]?.backwardTail ?? CONTRACT_FLOOR_BLOCK;
}

async function tickForward() {
  try {
    const state = (
      await db
        .select()
        .from(indexerStateTable)
        .where(eq(indexerStateTable.id, STATE_ID))
        .limit(1)
    )[0];
    if (!state) return;
    const head = Number(await client.getBlockNumber());
    if (state.forwardHead >= head) return;
    const fromBlock = state.forwardHead + 1;
    const toBlock = Math.min(fromBlock + MAX_RANGE - 1, head);
    const chunk = await fetchChunk(fromBlock, toBlock);
    await persistChunk(chunk, "forward");
    logger.debug(
      { fromBlock, toBlock, trades: chunk.totalTradeCount },
      "forward chunk processed",
    );
  } catch (err) {
    logger.warn({ err }, "forward tick failed");
  }
}

async function tickBackward() {
  try {
    const state = (
      await db
        .select()
        .from(indexerStateTable)
        .where(eq(indexerStateTable.id, STATE_ID))
        .limit(1)
    )[0];
    if (!state) return;
    const floor = await getFloor();
    if (state.backwardTail <= floor) return;

    // Plan up to BACKWARD_PARALLELISM contiguous chunks below the current tail
    // and fetch them concurrently. Persisted serially to keep state consistent.
    const ranges: { fromBlock: number; toBlock: number }[] = [];
    let cursor = state.backwardTail - 1;
    for (let i = 0; i < BACKWARD_PARALLELISM && cursor > floor; i++) {
      const toBlock = cursor;
      const fromBlock = Math.max(toBlock - MAX_RANGE + 1, floor);
      ranges.push({ fromBlock, toBlock });
      cursor = fromBlock - 1;
    }

    const chunks = await Promise.all(
      ranges.map((r) => fetchChunk(r.fromBlock, r.toBlock)),
    );
    for (const chunk of chunks) {
      await persistChunk(chunk, "backward");
      logger.debug(
        { fromBlock: chunk.fromBlock, toBlock: chunk.toBlock, trades: chunk.totalTradeCount },
        "backward chunk processed",
      );
    }
  } catch (err) {
    logger.warn({ err }, "backward tick failed");
  }
}

// Backfill: find block ranges already present in block_buckets but missing from
// account_buckets (because per-account tracking was added after some chunks were
// already indexed) and re-fetch logs for them so the leaderboard sees full history.
async function tickBackfillAccounts() {
  try {
    const rows = await db.execute(sql`
      SELECT bb.from_block, bb.to_block
      FROM block_buckets bb
      LEFT JOIN account_buckets ab ON ab.from_block = bb.from_block
      WHERE ab.from_block IS NULL AND bb.trade_count > 0
      ORDER BY bb.timestamp_ms DESC
      LIMIT ${BACKWARD_PARALLELISM}
    `);
    const ranges = (rows.rows as { from_block: string | number; to_block: string | number }[])
      .map((r) => ({
        fromBlock: Number(r.from_block),
        toBlock: Number(r.to_block),
      }));
    if (ranges.length === 0) return;
    const chunks = await Promise.all(
      ranges.map((r) => fetchChunk(r.fromBlock, r.toBlock)),
    );
    for (const chunk of chunks) {
      // Only persist per-account / per-market data — block bucket already exists
      // and totals are already counted in indexer_state, so we don't double-add.
      await db.transaction(async (tx) => {
        if (chunk.perAccount.size > 0) {
          await tx
            .insert(accountBucketsTable)
            .values(
              Array.from(chunk.perAccount, ([accountId, a]) => ({
                fromBlock: chunk.fromBlock,
                accountId,
                timestampMs: chunk.timestampMs,
                volumeUsd: a.volumeUsd,
                feesUsd: a.feesUsd,
                pnlUsd: a.pnlUsd,
                tradeCount: a.tradeCount,
              })),
            )
            .onConflictDoNothing();
        }
      });
      logger.debug(
        { fromBlock: chunk.fromBlock, accounts: chunk.perAccount.size },
        "backfill chunk processed",
      );
    }
  } catch (err) {
    logger.warn({ err }, "backfill tick failed");
  }
}

export { tickForward, tickBackward, tickBackfillAccounts, ensureState };

let started = false;
export function startIndexer() {
  if (started) return;
  started = true;
  void (async () => {
    try {
      await ensureState();
      logger.info("Perpl indexer started");
      // Run loops independently so a slow forward call does not stall backward.
      const loop = async (
        fn: () => Promise<void>,
        intervalMs: number,
        name: string,
      ) => {
        for (;;) {
          const t0 = Date.now();
          try {
            await fn();
          } catch (err) {
            logger.warn({ err, name }, "loop iteration failed");
          }
          const elapsed = Date.now() - t0;
          await new Promise((r) =>
            setTimeout(r, Math.max(0, intervalMs - elapsed)),
          );
        }
      };
      void loop(tickForward, FORWARD_INTERVAL_MS, "forward");
      void loop(tickBackward, BACKWARD_INTERVAL_MS, "backward");
      void loop(tickBackfillAccounts, 600, "backfill-accounts");
    } catch (err) {
      logger.error({ err }, "Indexer failed to start");
    }
  })();
}

export async function getChainHeadCached(): Promise<number> {
  try {
    return Number(await client.getBlockNumber());
  } catch {
    return 0;
  }
}

export async function getContractFloorCached(): Promise<number> {
  return getFloor();
}
