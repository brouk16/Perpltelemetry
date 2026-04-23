import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { 
  useGetStats, 
  getGetStatsQueryKey, 
  useGetMarketStats, 
  getGetMarketStatsQueryKey,
  useGetVolumeTimeseries,
  getGetVolumeTimeseriesQueryKey,
  useGetOiHistory,
  getGetOiHistoryQueryKey,
} from "@workspace/api-client-react";
import { 
  formatUsdCompact, 
  formatUsdFull, 
  formatNumberCompact, 
  timeAgo,
  cn 
} from "@/lib/utils";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import Leaderboard from "@/components/Leaderboard";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, LineChart, Line } from "recharts";
import { Activity, Server, Database, Globe, ChevronRight, LayoutGrid, Trophy, Users, TrendingUp } from "lucide-react";

type Tab = "overview" | "leaderboard";

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("overview");

  const { data: stats, isLoading: statsLoading, isError: statsError } = useGetStats({
    query: { refetchInterval: 10000, queryKey: getGetStatsQueryKey() }
  });

  const { data: marketStatsData, isLoading: marketsLoading } = useGetMarketStats({
    query: { refetchInterval: 15000, queryKey: getGetMarketStatsQueryKey() }
  });

  const { data: tsData, isLoading: tsLoading } = useGetVolumeTimeseries({
    query: { refetchInterval: 30000, queryKey: getGetVolumeTimeseriesQueryKey() }
  });

  const { data: oiData } = useGetOiHistory({
    query: { refetchInterval: 30000, queryKey: getGetOiHistoryQueryKey() }
  });

  const markets = marketStatsData?.markets || [];
  const timeseries = tsData?.points || [];

  const chartData = useMemo(() => {
    return timeseries.map(pt => ({
      time: new Date(pt.timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      volume: pt.volumeUsd,
      trades: pt.tradeCount
    })).reverse();
  }, [timeseries]);

  const oiChart = useMemo(() => {
    return (oiData?.points ?? []).map((pt) => ({
      time: new Date(pt.timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      oi: pt.oiUsd,
    }));
  }, [oiData]);
  const oiPerMarket = oiData?.perMarket ?? [];

  if (statsLoading || (tab === "overview" && (marketsLoading || tsLoading))) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-primary font-mono">
        <Activity className="w-12 h-12 animate-pulse mb-4" />
        <p className="tracking-widest opacity-80">INITIALIZING TELEMETRY...</p>
      </div>
    );
  }

  if (statsError || !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-destructive font-mono">
        <p className="tracking-widest">ERROR: NO SIGNAL</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col font-mono relative overflow-hidden">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 border-b border-primary/20 pb-4 relative z-10">
        <div className="glitch-hover cursor-default">
          <h1 className="text-3xl md:text-5xl font-black text-primary tracking-tighter uppercase leading-none">
            PERPL // TELEMETRY
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground tracking-widest mt-2 uppercase">
            Decentralized Perpetual Futures on Monad
          </p>
        </div>
        <div className="mt-4 md:mt-0 flex flex-col items-end text-xs tracking-wider space-y-1">
          <div className="flex items-center text-secondary">
            <span className="w-2 h-2 rounded-full bg-secondary animate-pulse mr-2"></span>
            LIVE
          </div>
          <span className="text-muted-foreground uppercase opacity-70">
            LAST PING {timeAgo(stats.lastUpdatedMs)} AGO
          </span>
          <a 
            href="https://app.perpl.xyz/trade?ref=FJteZ4GVdAD" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary hover:text-primary-foreground transition-colors flex items-center mt-2 border border-primary/30 px-3 py-1 hover:bg-primary/20 corner-brackets"
          >
            TERMINAL <ChevronRight className="w-3 h-3 ml-1" />
          </a>
        </div>
      </header>

      {/* TABS */}
      <div className="flex gap-2 mb-6 relative z-10">
        {([
          { id: "overview" as const, label: "OVERVIEW", icon: LayoutGrid },
          { id: "leaderboard" as const, label: "LEADERBOARD", icon: Trophy },
        ]).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-xs tracking-widest uppercase font-mono border transition-colors corner-brackets relative",
                active
                  ? "border-primary text-primary bg-primary/10"
                  : "border-primary/20 text-muted-foreground hover:text-foreground hover:border-primary/40",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {active && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute -bottom-px left-0 right-0 h-px bg-primary"
                />
              )}
            </button>
          );
        })}
      </div>

      {tab === "leaderboard" && (
        <main className="relative z-10 flex-1">
          <Leaderboard />
        </main>
      )}

      {/* MAIN GRID */}
      {tab === "overview" && (
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10 flex-1">
        
        {/* LEFT COLUMN: HEADLINES */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 24H VOL */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card border border-primary/20 p-6 corner-brackets relative group"
            >
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <p className="text-xs text-muted-foreground tracking-widest uppercase mb-2">24H Volume</p>
              <Tooltip>
                <TooltipTrigger className="text-left">
                  <div className="text-4xl md:text-5xl font-bold text-primary">
                    <AnimatedNumber value={stats.dailyVolumeUsd} formatFn={formatUsdCompact} />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="font-mono bg-card border-primary/50 text-foreground">
                  {formatUsdFull(stats.dailyVolumeUsd)}
                </TooltipContent>
              </Tooltip>
              <div className="mt-4 flex justify-between text-xs text-muted-foreground uppercase">
                <span>Trades: <AnimatedNumber value={stats.dailyTradeCount} formatFn={formatNumberCompact} className="text-foreground" /></span>
                <span>Fees: <AnimatedNumber value={stats.dailyFeesUsd} formatFn={formatUsdCompact} className="text-foreground" /></span>
              </div>
            </motion.div>

            {/* ALL-TIME VOL */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-card border border-primary/20 p-6 corner-brackets relative group"
            >
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <p className="text-xs text-muted-foreground tracking-widest uppercase mb-2">
                Cumulative Volume
              </p>
              <Tooltip>
                <TooltipTrigger className="text-left">
                  <div className="text-4xl md:text-5xl font-bold text-foreground">
                    <AnimatedNumber value={stats.totalVolumeUsd} formatFn={formatUsdCompact} />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="font-mono bg-card border-primary/50 text-foreground max-w-xs">
                  <div className="text-foreground font-bold mb-1">{formatUsdFull(stats.totalVolumeUsd)}</div>
                  {stats.baselineVolumeUsd != null && (
                    <div className="text-[10px] text-muted-foreground tracking-widest uppercase leading-relaxed">
                      Baseline {formatUsdCompact(stats.baselineVolumeUsd)} (DefiLlama snapshot)<br />
                      + Indexed delta {formatUsdCompact(stats.indexedDeltaVolumeUsd ?? 0)}
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>
              <div className="mt-2 flex items-center gap-1.5 text-[9px] tracking-widest uppercase text-secondary/80">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>
                <span>Anchored to DefiLlama snapshot · live delta on-chain</span>
              </div>
              <div className="mt-4 flex justify-between text-xs text-muted-foreground uppercase">
                <span>Total Trades: <AnimatedNumber value={stats.totalTradeCount} formatFn={formatNumberCompact} className="text-foreground" /></span>
                <span>Total Fees: <AnimatedNumber value={stats.totalFeesUsd} formatFn={formatUsdCompact} className="text-foreground" /></span>
              </div>
            </motion.div>

            {/* TOTAL USERS */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-card border border-primary/20 p-6 corner-brackets relative group"
            >
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <p className="text-xs text-muted-foreground tracking-widest uppercase mb-2 flex items-center">
                <Users className="w-3.5 h-3.5 mr-2 text-primary" /> Total Users
              </p>
              <Tooltip>
                <TooltipTrigger className="text-left">
                  <div className="text-4xl md:text-5xl font-bold text-foreground">
                    <AnimatedNumber value={stats.totalUsers ?? 0} formatFn={formatNumberCompact} />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="font-mono bg-card border-primary/50 text-foreground">
                  {(stats.totalUsers ?? 0).toLocaleString()} distinct on-chain accounts
                </TooltipContent>
              </Tooltip>
              <div className="mt-2 text-[9px] tracking-widest uppercase text-muted-foreground">
                Distinct accountIds since contract genesis
              </div>
              <div className="mt-4 text-xs text-muted-foreground uppercase">
                Avg vol/user: <span className="text-foreground">{formatUsdCompact((stats.totalUsers ?? 0) > 0 ? stats.totalVolumeUsd / (stats.totalUsers ?? 1) : 0)}</span>
              </div>
            </motion.div>

            {/* OPEN INTEREST */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-card border border-primary/20 p-6 corner-brackets relative group"
            >
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <p className="text-xs text-muted-foreground tracking-widest uppercase mb-2 flex items-center">
                <TrendingUp className="w-3.5 h-3.5 mr-2 text-primary" /> Open Interest
              </p>
              <Tooltip>
                <TooltipTrigger className="text-left">
                  <div className="text-4xl md:text-5xl font-bold text-primary">
                    <AnimatedNumber value={stats.openInterestUsd ?? 0} formatFn={formatUsdCompact} />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="font-mono bg-card border-primary/50 text-foreground">
                  {formatUsdFull(stats.openInterestUsd ?? 0)}
                </TooltipContent>
              </Tooltip>
              <div className="mt-2 flex items-center gap-1.5 text-[9px] tracking-widest uppercase text-secondary/80">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>
                <span>{(stats.openInterestAtMs ?? 0) > 0 ? `Live · synced ${timeAgo(stats.openInterestAtMs ?? 0)} ago` : "Awaiting first market-state frame"}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground uppercase">
                {oiPerMarket.slice(0, 4).map((m) => (
                  <span key={m.perpId}>
                    {m.symbol}: <span className="text-foreground">{formatUsdCompact(m.oiUsd)}</span>
                  </span>
                ))}
              </div>
            </motion.div>
          </div>

          {/* CHART */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card border border-primary/20 p-6 corner-brackets flex-1 min-h-[300px] flex flex-col"
          >
            <p className="text-xs text-muted-foreground tracking-widest uppercase mb-6 flex items-center">
              <Activity className="w-4 h-4 mr-2 text-primary" />
              Volume Flow (24H)
            </p>
            <div className="flex-1 w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorVol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false}
                    tickFormatter={(v) => formatUsdCompact(v)}
                  />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--primary)/0.5)', fontFamily: 'inherit' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                    formatter={(value: number) => [formatUsdCompact(value), 'Volume']}
                    labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                  />
                  <Area type="step" dataKey="volume" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorVol)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* OI CHART */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-card border border-primary/20 p-6 corner-brackets min-h-[260px] flex flex-col"
          >
            <div className="flex items-center justify-between mb-6">
              <p className="text-xs text-muted-foreground tracking-widest uppercase flex items-center">
                <TrendingUp className="w-4 h-4 mr-2 text-secondary" />
                Open Interest (24H)
              </p>
              <span className="text-xs text-secondary font-bold">
                {formatUsdCompact(stats.openInterestUsd ?? 0)}
              </span>
            </div>
            <div className="flex-1 w-full relative min-h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={oiChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatUsdCompact(v)}
                    domain={["auto", "auto"]}
                  />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--secondary)/0.5)', fontFamily: 'inherit' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                    formatter={(value: number) => [formatUsdCompact(value), 'OI']}
                    labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                  />
                  <Line type="monotone" dataKey="oi" stroke="hsl(var(--secondary))" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {oiPerMarket.length > 0 && (
              <div className="mt-4 pt-3 border-t border-primary/10 flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase tracking-widest">
                {oiPerMarket.map((m) => (
                  <span key={m.perpId} className="text-muted-foreground">
                    {m.symbol}: <span className="text-foreground">{formatUsdCompact(m.oiUsd)}</span>
                    {m.markPrice > 0 && (
                      <span className="text-muted-foreground/60 ml-1">@{formatUsdCompact(m.markPrice)}</span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        </div>

        {/* RIGHT COLUMN: MARKETS & INDEXER */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* MARKETS */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-card border border-primary/20 p-6 corner-brackets flex-1"
          >
            <p className="text-xs text-muted-foreground tracking-widest uppercase mb-6 flex items-center">
              <Globe className="w-4 h-4 mr-2 text-primary" />
              Market Matrix
            </p>
            <div className="space-y-4">
              {markets.map((m) => (
                <div key={m.perpId} className="flex flex-col group border-b border-primary/10 pb-4 last:border-0 last:pb-0">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-lg font-bold text-foreground group-hover:text-primary transition-colors uppercase">
                      {m.symbol}
                    </span>
                    <span className="text-sm font-bold text-primary">
                      {formatUsdCompact(m.dailyVolumeUsd)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-widest">
                    <span>ID: {m.perpId.toString().padStart(3, '0')}</span>
                    <span>{formatNumberCompact(m.dailyTradeCount)} Txs</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* SYSTEM STATUS */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-card border border-primary/20 p-6 corner-brackets"
          >
            <p className="text-xs text-muted-foreground tracking-widest uppercase mb-6 flex items-center">
              <Database className="w-4 h-4 mr-2 text-primary" />
              Indexer Subsystem
            </p>
            
            <div className="space-y-4 text-xs tracking-widest">
              <div>
                <div className="flex justify-between mb-1 uppercase">
                  <span className="text-muted-foreground">Sync Progress</span>
                  <span className="text-secondary font-bold">{(stats.indexedFraction * 100).toFixed(2)}%</span>
                </div>
                <div className="h-1 bg-muted w-full overflow-hidden relative">
                  <motion.div 
                    className="absolute top-0 left-0 h-full bg-secondary"
                    initial={{ width: 0 }}
                    animate={{ width: `${stats.indexedFraction * 100}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <p className="text-muted-foreground uppercase text-[10px]">Head Block</p>
                  <p className="text-foreground">{stats.indexerHeadBlock.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase text-[10px]">Tail Block</p>
                  <p className="text-foreground">{stats.indexerTailBlock.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase text-[10px]">Chain Head</p>
                  <p className="text-foreground">{stats.chainHeadBlock.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase text-[10px]">Genesis</p>
                  <p className="text-foreground">{stats.contractStartBlock.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
      )}

      {/* FOOTER */}
      <footer className="mt-12 border-t border-primary/20 pt-4 text-[10px] md:text-xs text-muted-foreground tracking-widest uppercase flex flex-col md:flex-row justify-between items-center text-center md:text-left gap-2 relative z-10">
        <p>Stats indexed directly from Monad mainnet</p>
        <p className="flex items-center">
          <Server className="w-3 h-3 mr-1" />
          Contract 0x34B6552d57a35a1D042CcAe1951BD1C370112a6F
        </p>
      </footer>
    </div>
  );
}
