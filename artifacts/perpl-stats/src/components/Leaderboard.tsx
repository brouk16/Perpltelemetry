import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  Trophy,
  Activity,
  Loader2,
  TrendingUp,
  TrendingDown,
  Link2,
  ExternalLink,
  X,
  CheckCircle,
  AlertCircle,
} from "lucide-react";

type Period = "day" | "all";
type Metric = "volume" | "pnl";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const EXPLORER_BASE = "https://explorer.monad.xyz/address";

function truncateWallet(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function WalletClaimModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [wallet, setWallet] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrMsg("");
    try {
      const res = await fetch(`${API_BASE}/stats/wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: accountId.trim(),
          walletAddress: wallet.trim(),
          label: label.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrMsg(body.error ?? "Unknown error");
        setStatus("error");
        return;
      }
      setStatus("ok");
      setTimeout(() => {
        onSuccess();
        onClose();
        setStatus("idle");
        setAccountId("");
        setWallet("");
        setLabel("");
      }, 1200);
    } catch (err) {
      setErrMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-md mx-4 bg-card border border-primary/40 p-6 corner-brackets z-10"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <p className="text-xs tracking-widest uppercase text-primary mb-1 font-mono flex items-center gap-2">
          <Link2 className="w-4 h-4" />
          LINK WALLET TO ACCOUNT
        </p>
        <p className="text-xs text-muted-foreground mb-5">
          Self-declare your wallet address next to your Perpl account ID in the leaderboard.
          This is voluntary and unverified — anyone can link any wallet.
        </p>

        <form onSubmit={submit} className="space-y-4 font-mono">
          <div>
            <label className="block text-[10px] tracking-widest uppercase text-muted-foreground mb-1">
              Account ID *
            </label>
            <input
              type="text"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="e.g. 12345"
              required
              className="w-full bg-background border border-primary/30 px-3 py-2 text-sm text-foreground
                         focus:outline-none focus:border-primary placeholder:text-muted-foreground/50"
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-widest uppercase text-muted-foreground mb-1">
              Wallet Address *
            </label>
            <input
              type="text"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="0x..."
              required
              className="w-full bg-background border border-primary/30 px-3 py-2 text-sm text-foreground
                         focus:outline-none focus:border-primary placeholder:text-muted-foreground/50"
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-widest uppercase text-muted-foreground mb-1">
              Label (optional)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. degen.eth or whale01"
              maxLength={64}
              className="w-full bg-background border border-primary/30 px-3 py-2 text-sm text-foreground
                         focus:outline-none focus:border-primary placeholder:text-muted-foreground/50"
            />
          </div>

          {status === "error" && (
            <div className="flex items-center gap-2 text-destructive text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {errMsg}
            </div>
          )}
          {status === "ok" && (
            <div className="flex items-center gap-2 text-secondary text-xs">
              <CheckCircle className="w-4 h-4 shrink-0" />
              Wallet linked successfully!
            </div>
          )}

          <button
            type="submit"
            disabled={status === "loading" || status === "ok"}
            className="w-full bg-primary/20 border border-primary/50 hover:bg-primary/30 text-primary
                       px-4 py-2 text-xs tracking-widest uppercase transition-colors disabled:opacity-50
                       flex items-center justify-center gap-2"
          >
            {status === "loading" ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                SUBMITTING...
              </>
            ) : status === "ok" ? (
              <>
                <CheckCircle className="w-3 h-3" />
                LINKED
              </>
            ) : (
              "CONFIRM LINK"
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

export default function Leaderboard() {
  const [period, setPeriod] = useState<Period>("day");
  const [metric, setMetric] = useState<Metric>("volume");
  const [modalOpen, setModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const params = { period, metric, limit: 25 };
  const queryKey = getGetLeaderboardQueryKey(params);
  const { data, isLoading, isFetching } = useGetLeaderboard(params, {
    query: {
      refetchInterval: 20000,
      queryKey,
    },
  });

  const entries = data?.entries ?? [];

  function handleWalletSuccess() {
    queryClient.invalidateQueries({ queryKey });
  }

  return (
    <>
      <AnimatePresence>
        {modalOpen && (
          <WalletClaimModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            onSuccess={handleWalletSuccess}
          />
        )}
      </AnimatePresence>

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
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 border border-secondary/40 text-secondary
                         px-3 py-1.5 text-[10px] tracking-widest uppercase font-mono
                         hover:bg-secondary/10 transition-colors"
            >
              <Link2 className="w-3 h-3" />
              LINK WALLET
            </button>
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
                        <div className="flex flex-col gap-0.5">
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
                          {e.walletAddress ? (
                            <div className="flex items-center gap-1">
                              {e.label && (
                                <span className="text-secondary text-[10px] tracking-widest">
                                  {e.label}
                                </span>
                              )}
                              <a
                                href={`${EXPLORER_BASE}/${e.walletAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-muted-foreground hover:text-primary transition-colors
                                           flex items-center gap-0.5 underline-offset-2 hover:underline"
                                title={e.walletAddress}
                              >
                                {truncateWallet(e.walletAddress)}
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            </div>
                          ) : null}
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
          Account IDs are Perpl's internal identifiers · Wallet links are self-declared and unverified · PnL = realized from on-chain fills
        </p>
      </motion.div>
    </>
  );
}
