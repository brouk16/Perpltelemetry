import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useGetLeaderboard,
  getGetLeaderboardQueryKey,
} from "@workspace/api-client-react";
import {
  formatUsdCompact,
  formatUsdFull,
  formatNumberCompact,
  cn,
} from "@/lib/utils";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Trophy, Activity, Loader2, TrendingUp, TrendingDown } from "lucide-react";

type Period = "day" | "all";
type Metric = "volume" | "pnl";

export default function Leaderboard() {
  const [period, setPeriod] = useState<Period>("day");
  const [metric, setMetric] = useState<Metric>("volume");

  const params = { period, metric, limit: 25 };
  const { data, isLoading, isFetching } = useGetLeaderboard(params, {
    query: {
      refetchInterval: 20000,
      queryKey: getGetLeaderboardQueryKey(params),
    },
  });

  const entries = data?.entries ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-primary/20 p-6 corner-brackets relative z-10"
    >
      <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
        <p className="text-xs text-muted-foreground tracking-widest uppercase flex items-center">
          <Trophy className="w-4 h-4 mr-2 text-primary" />
          Top Operators // Ranked by {metric === "pnl" ? "PnL" : "Volume"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-primary/30 text-[10px] tracking-widest uppercase font-mono">
            {(["volume", "pnl"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={cn(
                  "px-3 py-1.5 transition-colors",
                  metric === m
                    ? "bg-secondary/20 text-secondary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "volume" ? "VOLUME" : "PNL"}
              </button>
            ))}
          </div>
          <div className="flex border border-primary/30 text-[10px] tracking-widest uppercase font-mono">
            {(["day", "all"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-3 py-1.5 transition-colors",
                  period === p
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p === "day" ? "24H" : "ALL-TIME"}
              </button>
            ))}
          </div>
          {isFetching && (
            <span className="text-secondary">
              <Loader2 className="w-3 h-3 animate-spin" />
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Activity className="w-5 h-5 mr-3 animate-pulse" /> SCANNING ROSTER...
        </div>
      ) : entries.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground tracking-widest uppercase text-xs">
          NO ACTIVITY DETECTED IN THIS WINDOW
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs md:text-sm font-mono">
            <thead>
              <tr className="text-[10px] tracking-widest uppercase text-muted-foreground border-b border-primary/20">
                <th className="text-left py-2 pr-2 w-12">Rank</th>
                <th className="text-left py-2 pr-2">Account</th>
                <th className="text-right py-2 pr-2">
                  {metric === "pnl" ? "PnL" : "Volume"}
                </th>
                <th className="text-right py-2 pr-2 hidden md:table-cell">
                  {metric === "pnl" ? "Volume" : "PnL"}
                </th>
                <th className="text-right py-2 pr-2 hidden lg:table-cell">Fees</th>
                <th className="text-right py-2">Trades</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {entries.map((e) => (
                  <motion.tr
                    key={e.accountId}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="border-b border-primary/10 hover:bg-primary/5 group"
                  >
                    <td className="py-3 pr-2 text-muted-foreground">
                      <span
                        className={cn(
                          "font-bold",
                          e.rank === 1 && "text-secondary",
                          e.rank === 2 && "text-primary",
                          e.rank === 3 && "text-foreground",
                        )}
                      >
                        {e.rank.toString().padStart(2, "0")}
                      </span>
                    </td>
                    <td className="py-3 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground group-hover:text-primary transition-colors">
                          ACCT #{e.accountId}
                        </span>
                        {e.rank <= 3 && (
                          <Trophy
                            className={cn(
                              "w-3 h-3",
                              e.rank === 1 && "text-secondary",
                              e.rank === 2 && "text-primary",
                              e.rank === 3 && "text-muted-foreground",
                            )}
                          />
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-2 text-right">
                      {metric === "pnl" ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={cn(
                                "font-bold cursor-default inline-flex items-center gap-1",
                                e.pnlUsd >= 0 ? "text-secondary" : "text-destructive",
                              )}
                            >
                              {e.pnlUsd >= 0 ? (
                                <TrendingUp className="w-3 h-3" />
                              ) : (
                                <TrendingDown className="w-3 h-3" />
                              )}
                              <AnimatedNumber
                                value={e.pnlUsd}
                                formatFn={(v) =>
                                  (v >= 0 ? "+" : "-") + formatUsdCompact(Math.abs(v))
                                }
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="font-mono bg-card border-primary/50 text-foreground">
                            {(e.pnlUsd >= 0 ? "+" : "-") + formatUsdFull(Math.abs(e.pnlUsd))}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-primary font-bold cursor-default">
                              <AnimatedNumber
                                value={e.volumeUsd}
                                formatFn={formatUsdCompact}
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="font-mono bg-card border-primary/50 text-foreground">
                            {formatUsdFull(e.volumeUsd)}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </td>
                    <td className="py-3 pr-2 text-right text-muted-foreground hidden md:table-cell">
                      {metric === "pnl"
                        ? formatUsdCompact(e.volumeUsd)
                        : (e.pnlUsd >= 0 ? "+" : "-") +
                          formatUsdCompact(Math.abs(e.pnlUsd))}
                    </td>
                    <td className="py-3 pr-2 text-right text-muted-foreground hidden lg:table-cell">
                      {formatUsdCompact(e.feesUsd)}
                    </td>
                    <td className="py-3 text-right text-foreground">
                      {formatNumberCompact(e.tradeCount)}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-[10px] text-muted-foreground tracking-widest uppercase opacity-70">
        Account IDs are Perpl's internal identifiers. PnL = realized PnL aggregated from on-chain fills. Backfilling 24h history...
      </p>
    </motion.div>
  );
}
