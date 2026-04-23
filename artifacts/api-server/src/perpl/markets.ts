export const PERPL_EXCHANGE_ADDRESS =
  "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F" as const;

export const MAKER_ORDER_FILLED_TOPIC =
  "0x99fb7f3a1ddee0bb6dffd2236f7a9b6cab5957f2cb19a48b27a0d6c47e0b1eea" as const;

// keccak256 of: MakerOrderFilled(uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256,uint256)
// We compute this at runtime in the indexer — kept here only as a fallback constant.

export type Market = {
  perpId: number;
  symbol: string;
  priceDecimals: number;
  lotDecimals: number;
};

export const KNOWN_MARKETS: Record<number, Market> = {
  1: { perpId: 1, symbol: "BTC", priceDecimals: 1, lotDecimals: 5 },
  10: { perpId: 10, symbol: "MON", priceDecimals: 6, lotDecimals: 0 },
  20: { perpId: 20, symbol: "ETH", priceDecimals: 2, lotDecimals: 3 },
  30: { perpId: 30, symbol: "SOL", priceDecimals: 2, lotDecimals: 2 },
};
