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
  useGetVolumeBreakdown,
  getGetVolumeBreakdownQueryKey,
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
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, LineChart, Line, PieChart, Pie, Cell } from "recharts";
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

  const { data: volBreakdownData } = useGetVolumeBreakdown({
    query: { refetchInterval: 30000, queryKey: getGetVolumeBreakdownQueryKey() }
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

  const OI_COLORS = [
    "hsl(var(--primary))",
    "hsl(var(--secondary))",
    "hsl(160, 80%, 50%)",
    "hsl(280, 70%, 60%)",
    "hsl(40, 90%, 55%)",
    "hsl(200, 80%, 60%)",
  ];

  const stackedOiData = useMemo(() => {
    const history = oiData?.perMarketHistory;
    if (!history || history.length === 0) return null;
    const slots = history[0]?.points.map((p) => p.timestampMs) ?? [];
    return slots.map((ts, i) => {
      const row: Record<string, number | string> = {
        time: new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      for (const m of history) {
        row[m.symbol] = m.points[i]?.oiUsd ?? 0;
      }
      return row;
    });
  }, [oiData]);

  const pieData = useMemo(() => {
    return oiPerMarket.filter((m) => m.oiUsd > 0).map((m) => ({
      name: m.symbol,
      value: m.oiUsd,
    }));
  }, [oiPerMarket]);

  const volPerMarket = volBreakdownData?.perMarket ?? [];
  const totalVolBreakdown = volPerMarket.reduce((s, m) => s + m.volumeUsd24h, 0);

  const volPieData = useMemo(() => {
    return volPerMarket.filter((m) => m.volumeUsd24h > 0).map((m) => ({
      name: m.symbol,
      value: m.volumeUsd24h,
    }));
  }, [volPerMarket]);

  const stackedVolData = useMemo(() => {
    const history = volBreakdownData?.perMarketHistory;
    if (!history || history.length === 0) return null;
    const slots = history[0]?.points.map((p) => p.timestampMs) ?? [];
    return slots.map((ts, i) => {
      const row: Record<string, number | string> = {
        time: new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      for (const m of history) {
        row[m.symbol] = m.points[i]?.volumeUsd ?? 0;
      }
      return row;
    });
  }, [volBreakdownData]);

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
                  {(stats.totalUsers ?? 0).toLocaleString()} accounts created on-chain
                </TooltipContent>
              </Tooltip>
              <div className="mt-2 text-[9px] tracking-widest uppercase text-muted-foreground">
                Total accounts created on-chain
              </div>
              <div className="mt-4 text-xs text-muted-foreground uppercase">
                Avg vol/user: <span className="text-foreground">{formatUsdCompact((stats.totalUsers ?? 0) > 0 ? stats.totalVolumeUsd / (stats.totalUsers ?? 1) : 0)}</span>
              </div>
            </motion.div>

            {/* TVL */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-card border border-primary/20 p-6 corner-brackets relative group"
            >
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <p className="text-xs text-muted-foreground tracking-widest uppercase mb-2 flex items-center">
                <Database className="w-3.5 h-3.5 mr-2 text-primary" /> TVL
              </p>
              <Tooltip>
                <TooltipTrigger className="text-left">
                  <div className="text-4xl md:text-5xl font-bold text-primary">
                    <AnimatedNumber value={stats.tvlUsd ?? 0} formatFn={formatUsdCompact} />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="font-mono bg-card border-primary/50 text-foreground">
                  {formatUsdFull(stats.tvlUsd ?? 0)} total value locked
                </TooltipContent>
              </Tooltip>
              <div className="mt-2 text-[9px] tracking-widest uppercase text-muted-foreground">
                AUSD deposited in exchange contract
              </div>
              <div className="mt-4 text-xs text-muted-foreground uppercase">
                Collateral: <span className="text-foreground">AUSD</span>
              </div>
            </motion.div>

            {/* OPEN INTEREST */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
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

          {/* VOLUME FLOW + BREAKDOWN — single unified block */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card border border-primary/20 p-6 corner-brackets flex flex-col gap-5"
          >
            {/* header */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground tracking-widest uppercase flex items-center">
                <Activity className="w-4 h-4 mr-2 text-primary" />
                Volume Flow (24H)
              </p>
              <span className="text-xs text-primary font-bold">
                {formatUsdCompact(totalVolBreakdown > 0 ? totalVolBreakdown : stats.dailyVolumeUsd)} TOTAL
              </span>
            </div>

            {/* main chart — stacked by market, falls back to simple total */}
            <div className="w-full">
              <ResponsiveContainer width="100%" height={240}>
                {stackedVolData && (volBreakdownData?.perMarketHistory?.length ?? 0) > 0 ? (
                  <AreaChart data={stackedVolData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      {(volBreakdownData?.perMarketHistory ?? []).map((m, idx) => (
                        <linearGradient key={m.perpId} id={`volGrad${idx}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={OI_COLORS[idx % OI_COLORS.length]} stopOpacity={0.45} />
                          <stop offset="95%" stopColor={OI_COLORS[idx % OI_COLORS.length]} stopOpacity={0.04} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatUsdCompact(v)} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--primary)/0.4)', fontFamily: 'inherit', fontSize: 11 }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                      labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: 4 }}
                      formatter={(value: number, name: string) => [formatUsdCompact(value), name]}
                    />
                    {(volBreakdownData?.perMarketHistory ?? []).map((m, idx) => (
                      <Area
                        key={m.perpId}
                        type="monotone"
                        dataKey={m.symbol}
                        stackId="vol"
                        stroke={OI_COLORS[idx % OI_COLORS.length]}
                        fill={`url(#volGrad${idx})`}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </AreaChart>
                ) : (
                  <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorVolMain" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatUsdCompact(v)} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--primary)/0.5)', fontFamily: 'inherit' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                      formatter={(value: number) => [formatUsdCompact(value), 'Volume']}
                      labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                    />
                    <Area type="step" dataKey="volume" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorVolMain)" isAnimationActive={false} />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* pie + legend */}
            {volPieData.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center gap-6 pt-2 border-t border-primary/10">
                <div className="w-[140px] h-[140px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={volPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={42}
                        outerRadius={64}
                        paddingAngle={2}
                        dataKey="value"
                        isAnimationActive={false}
                      >
                        {volPieData.map((_, idx) => (
                          <Cell key={idx} fill={OI_COLORS[idx % OI_COLORS.length]} stroke="transparent" />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--primary)/0.3)', fontFamily: 'inherit', fontSize: 11 }}
                        formatter={(value: number, name: string) => [formatUsdCompact(value), name]}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  {volPerMarket.filter((m) => m.volumeUsd24h > 0).map((m, idx) => {
                    const total = totalVolBreakdown > 0 ? totalVolBreakdown : 1;
                    const pct = ((m.volumeUsd24h / total) * 100).toFixed(1);
                    return (
                      <div key={m.perpId} className="flex items-center gap-2 text-xs uppercase tracking-widest">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: OI_COLORS[idx % OI_COLORS.length] }} />
                        <span className="text-muted-foreground flex-1">{m.symbol}</span>
                        <span className="text-foreground font-bold">{formatUsdCompact(m.volumeUsd24h)}</span>
                        <span className="text-muted-foreground/60 w-10 text-right">{pct}%</span>
                        <span className="text-muted-foreground/40 hidden sm:inline">{formatNumberCompact(m.tradeCount24h)} txs</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>

          {/* OI BREAKDOWN */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-card border border-primary/20 p-6 corner-brackets flex flex-col gap-6"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground tracking-widest uppercase flex items-center">
                <TrendingUp className="w-4 h-4 mr-2 text-secondary" />
                Open Interest Breakdown
              </p>
              <span className="text-xs text-secondary font-bold">
                {formatUsdCompact(stats.openInterestUsd ?? 0)} TOTAL
              </span>
            </div>

            {/* PIE + LEGEND row */}
            {pieData.length > 0 ? (
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="w-[160px] h-[160px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={72}
                        paddingAngle={2}
                        dataKey="value"
                        isAnimationActive={false}
                      >
                        {pieData.map((_, idx) => (
                          <Cell key={idx} fill={OI_COLORS[idx % OI_COLORS.length]} stroke="transparent" />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--primary)/0.3)', fontFamily: 'inherit', fontSize: 11 }}
                        formatter={(value: number, name: string) => [formatUsdCompact(value), name]}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  {oiPerMarket.filter((m) => m.oiUsd > 0).map((m, idx) => {
                    const pct = (stats.openInterestUsd ?? 0) > 0
                      ? ((m.oiUsd / (stats.openInterestUsd ?? 1)) * 100).toFixed(1)
                      : "0.0";
                    return (
                      <div key={m.perpId} className="flex items-center gap-2 text-xs uppercase tracking-widest">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: OI_COLORS[idx % OI_COLORS.length] }}
                        />
                        <span className="text-muted-foreground flex-1">{m.symbol}</span>
                        <span className="text-foreground font-bold">{formatUsdCompact(m.oiUsd)}</span>
                        <span className="text-muted-foreground/60 w-10 text-right">{pct}%</span>
                        {m.markPrice > 0 && (
                          <span className="text-muted-foreground/40 hidden sm:inline">@{formatUsdCompact(m.markPrice)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground tracking-widest uppercase opacity-50">
                Awaiting first OI snapshot...
              </p>
            )}

            {/* STACKED AREA or FALLBACK LINE */}
            <div className="w-full relative min-h-[180px]">
              <p className="text-[10px] text-muted-foreground tracking-widest uppercase mb-3 opacity-60">24H History</p>
              <ResponsiveContainer width="100%" height={180}>
                {stackedOiData && (oiData?.perMarketHistory?.length ?? 0) > 0 ? (
                  <AreaChart data={stackedOiData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      {(oiData?.perMarketHistory ?? []).map((m, idx) => (
                        <linearGradient key={m.perpId} id={`oiGrad${idx}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={OI_COLORS[idx % OI_COLORS.length]} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={OI_COLORS[idx % OI_COLORS.length]} stopOpacity={0.05} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatUsdCompact(v)} domain={["auto", "auto"]} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--secondary)/0.5)', fontFamily: 'inherit', fontSize: 11 }}
                      formatter={(value: number, name: string) => [formatUsdCompact(value), name]}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                      labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                    />
                    {(oiData?.perMarketHistory ?? []).map((m, idx) => (
                      <Area
                        key={m.perpId}
                        type="monotone"
                        dataKey={m.symbol}
                        stackId="oi"
                        stroke={OI_COLORS[idx % OI_COLORS.length]}
                        fill={`url(#oiGrad${idx})`}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </AreaChart>
                ) : (
                  <LineChart data={oiChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatUsdCompact(v)} domain={["auto", "auto"]} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--secondary)/0.5)', fontFamily: 'inherit' }}
                      formatter={(value: number) => [formatUsdCompact(value), 'OI']}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                      labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                    />
                    <Line type="monotone" dataKey="oi" stroke="hsl(var(--secondary))" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
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
