import { keccak256, toBytes } from "viem";
const targets = new Set([
  "0x02d2bf39d2355aaa5486487e934403fd3ba3f88c73ab71938cee11931fddeb7b",
  "0xbf5d27a683d1ce858f6095fde2cc9837ba595c533e97576c5ff3de4376ccbf3c",
  "0x5d5d31f82cb7d7cf1b09787031cd282c6accc62145d50de980d298bb340a9aba",
  "0xe9805f82cb3729e97b234bb6bb4f90ea971e2c274201ff71818ebde153e1b0a6",
  "0xc2813e86d911b51775079b03b9fcab443ec450bc1634cf75dd578874a0af7add",
  "0xb853e5846ad52919c794f709695100094681c458cd1864d5217c6c897b6858b1",
  "0x65ec400f2e8b22c7064f99991d01828c6a55acaa066b3fdba3bf5a491b1a6a4c",
  "0xcd4a9f7ae1cc250eaa0be6bdb30d07efaf0faafb4ff0e76d8fe09a8373e43f85",
  "0xc0150ebb43a9c2478aa9c69d27078da071ceafb70e2d822d7d39a533e0418728",
  "0x599b5f439ed4daf1f28ae8638e5439d3982e8001fb26dd8f70021b38672eb26f",
  "0xb95e250f9f017dcb1bb1806916771df0c04a269e5f46d5db7519382a0f7bb477",
  "0x6be50b396ca4962b3810cd9e65b8160cd24180a1e7adbc2c795e8dd090891284",
  "0x33e0bf3ce98fac4118d5a0a8fe49e83b6acdfdef32871c9eca20e1528d7701ba",
  "0x9f38a7d29e6c9e707bfe5fee47b29748083dc31546de0135d48ed99db5e190f0",
  "0xc0ed4041bfe51a7b847f46f096b9d2495866089371037e3efd436bd858f46edd",
]);
// Common types we'll try
const T = ["uint256","int256","address","bytes32","uint128","int128","uint64","uint32","bool"];
const names = [
  "Liquidated","Liquidation","Liquidate","PositionLiquidated","AccountLiquidated",
  "OrderLiquidated","ForcedLiquidation","MakerOrderLiquidated","TakerOrderLiquidated",
  "Trade","Match","OrderMatched","OrderFilled","OrderPlaced","OrderCancelled",
  "OrderCanceled","OrderCreated","OrderUpdated","BalanceUpdated","AccountUpdated",
  "Deposit","Withdrawal","Withdraw","FundingPaid","FundingUpdate","FundingRate",
  "MarkPriceUpdate","IndexPriceUpdate","MarketCreated","PerpCreated","PerpUpdated",
  "MakerOrderPlaced","MakerOrderCancelled","TakerOrderPlaced","TakerOrderFilled",
  "PriceUpdate","LiqPrice","BookUpdate","BookOrderUpdated","TradeExecuted",
  "PositionOpened","PositionClosed","PositionUpdated","FundingTransferred",
  "FundingPayment","SocializeLoss","Insurance","InsuranceFundChange",
];
const hits = new Map();
function tryAll(name, max) {
  function gen(arr, n) {
    if (n === 0) {
      const sig = `${name}(${arr.join(",")})`;
      const h = keccak256(toBytes(sig));
      if (targets.has(h)) hits.set(h, sig);
      return;
    }
    for (const t of T) gen([...arr, t], n - 1);
  }
  for (let n = 1; n <= max; n++) gen([], n);
}
console.time("brute");
for (const n of names) tryAll(n, 7);
console.timeEnd("brute");
for (const [h, s] of hits) console.log(h, "=>", s);
console.log(`Resolved: ${hits.size}/${targets.size}`);
