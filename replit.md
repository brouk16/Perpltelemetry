# Perpl Stats

Sci-fi mission-control dashboard tracking on-chain stats for **Perpl**, a decentralized perpetual futures DEX on the **Monad** blockchain (https://app.perpl.xyz).

## Architecture

- **artifacts/perpl-stats** — React + Vite frontend (`/`). Dark Monad-purple/cyan HUD with framer-motion ticking digits and a Recharts 24h volume chart. Polls the API every 10–30s.
- **artifacts/api-server** — Express API exposing `/stats`, `/stats/markets`, `/stats/timeseries`, plus a background on-chain indexer.
- **lib/db** — Drizzle/Postgres schema for indexer state and per-bucket aggregates (`indexer_state`, `block_buckets`, `market_buckets`).
- **lib/api-spec / api-client-react / api-zod** — OpenAPI source of truth + generated typed hooks and zod validators.

## Indexer

- Decodes `MakerOrderFilled` events from the Perpl exchange contract `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` on Monad mainnet via `https://monad.drpc.org`.
- dRPC permits ~1000-block `eth_getLogs` ranges, so chunks are sized at 1000.
- Two concurrent loops: a forward scan keeps the head fresh, a backward scan walks toward the contract's first-active block (discovered via `eth_getCode` binary search).
- Volume = `pricePNS × lotLNS` decoded with each market's `priceDecimals` / `lotDecimals` (cached from `getPerpetualInfo`). Fees come straight from `feeCNS` (AUSD = 1:1 USD, 6 decimals). Maker fills only — taker side is the counterparty so counting both would double the volume.
- Aggregates persist per-block-range in `block_buckets` / `market_buckets`; running totals live on the `indexer_state` row.
- `indexedFraction = (forwardHead - backwardTail) / (chainHead - contractStart)` — surfaced to the UI as a sync progress bar so users understand "total volume" grows as history fills in.

## Development

- `pnpm --filter @workspace/db run push` — push Drizzle schema changes.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate typed clients/zod after editing `lib/api-spec/openapi.yaml`.
- Workflows: `artifacts/api-server: API Server`, `artifacts/perpl-stats: web`.
