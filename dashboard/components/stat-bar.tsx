import { TrendingUp, TrendingDown, Activity, Flame } from "lucide-react";

import type { StatsBundle } from "@/lib/types";

interface StatBarProps {
  stats: StatsBundle;
}

function formatVol(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

export function StatBar({ stats }: StatBarProps) {
  const cells: Array<{
    label: string;
    value: string;
    sub?: string;
    icon: React.ReactNode;
    tone?: "default" | "pump" | "dump";
  }> = [
    {
      label: "Signals",
      value: String(stats.signals_24h),
      sub: `${stats.pumps_24h} ↑ / ${stats.dumps_24h} ↓`,
      icon: <Activity className="h-4 w-4" />,
    },
    {
      label: "Avg pump",
      value: stats.avg_pump_pct ? `+${stats.avg_pump_pct.toFixed(2)}%` : "—",
      sub: `${stats.pumps_24h} hits`,
      icon: <TrendingUp className="h-4 w-4" />,
      tone: "pump",
    },
    {
      label: "Avg dump",
      value: stats.avg_dump_pct ? `${stats.avg_dump_pct.toFixed(2)}%` : "—",
      sub: `${stats.dumps_24h} hits`,
      icon: <TrendingDown className="h-4 w-4" />,
      tone: "dump",
    },
    {
      label: "Total volume",
      value: `$${formatVol(stats.total_vol_usdt)}`,
      sub: stats.top_coin ? `Top: ${stats.top_coin.symbol} ×${stats.top_coin.hits}` : "—",
      icon: <Flame className="h-4 w-4" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cells.map((c) => (
        <div
          key={c.label}
          className="bg-card border-border rounded-lg border p-4"
        >
          <div className="text-muted-foreground flex items-center justify-between text-xs uppercase tracking-wide">
            <span>{c.label}</span>
            <span
              className={
                c.tone === "pump"
                  ? "text-emerald-400"
                  : c.tone === "dump"
                  ? "text-rose-400"
                  : "text-muted-foreground"
              }
            >
              {c.icon}
            </span>
          </div>
          <div
            className={`mt-2 font-mono text-2xl font-semibold ${
              c.tone === "pump"
                ? "text-emerald-400"
                : c.tone === "dump"
                ? "text-rose-400"
                : "text-foreground"
            }`}
          >
            {c.value}
          </div>
          {c.sub ? (
            <div className="text-muted-foreground mt-1 text-xs">{c.sub}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
