import {
  pgTable,
  bigint,
  doublePrecision,
  integer,
  text,
  primaryKey,
  index,
  varchar,
} from "drizzle-orm/pg-core";

export const indexerStateTable = pgTable("indexer_state", {
  id: text("id").primaryKey(),
  forwardHead: bigint("forward_head", { mode: "number" }).notNull(),
  backwardTail: bigint("backward_tail", { mode: "number" }).notNull(),
  totalVolumeUsd: doublePrecision("total_volume_usd").notNull().default(0),
  totalFeesUsd: doublePrecision("total_fees_usd").notNull().default(0),
  totalTradeCount: bigint("total_trade_count", { mode: "number" })
    .notNull()
    .default(0),
  lastUpdatedMs: bigint("last_updated_ms", { mode: "number" }).notNull(),
});

export const blockBucketsTable = pgTable(
  "block_buckets",
  {
    fromBlock: bigint("from_block", { mode: "number" }).notNull(),
    toBlock: bigint("to_block", { mode: "number" }).notNull(),
    timestampMs: bigint("timestamp_ms", { mode: "number" }).notNull(),
    volumeUsd: doublePrecision("volume_usd").notNull(),
    feesUsd: doublePrecision("fees_usd").notNull(),
    tradeCount: integer("trade_count").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fromBlock] }),
    tsIdx: index("block_buckets_ts_idx").on(t.timestampMs),
  }),
);

export const accountBucketsTable = pgTable(
  "account_buckets",
  {
    fromBlock: bigint("from_block", { mode: "number" }).notNull(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    timestampMs: bigint("timestamp_ms", { mode: "number" }).notNull(),
    volumeUsd: doublePrecision("volume_usd").notNull(),
    feesUsd: doublePrecision("fees_usd").notNull(),
    pnlUsd: doublePrecision("pnl_usd").notNull().default(0),
    tradeCount: integer("trade_count").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fromBlock, t.accountId] }),
    tsIdx: index("account_buckets_ts_idx").on(t.timestampMs),
    acctIdx: index("account_buckets_acct_idx").on(t.accountId),
  }),
);

export const oiSnapshotsTable = pgTable(
  "oi_snapshots",
  {
    timestampMs: bigint("timestamp_ms", { mode: "number" }).notNull(),
    perpId: integer("perp_id").notNull(),
    oiUsd: doublePrecision("oi_usd").notNull(),
    markPrice: doublePrecision("mark_price").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.timestampMs, t.perpId] }),
    tsIdx: index("oi_snapshots_ts_idx").on(t.timestampMs),
  }),
);

export const accountWalletsTable = pgTable("account_wallets", {
  accountId: bigint("account_id", { mode: "number" }).primaryKey(),
  walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
  label: varchar("label", { length: 64 }),
  claimedAtMs: bigint("claimed_at_ms", { mode: "number" }).notNull(),
});

export const marketBucketsTable = pgTable(
  "market_buckets",
  {
    fromBlock: bigint("from_block", { mode: "number" }).notNull(),
    perpId: integer("perp_id").notNull(),
    timestampMs: bigint("timestamp_ms", { mode: "number" }).notNull(),
    volumeUsd: doublePrecision("volume_usd").notNull(),
    tradeCount: integer("trade_count").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fromBlock, t.perpId] }),
    tsIdx: index("market_buckets_ts_idx").on(t.timestampMs),
  }),
);
