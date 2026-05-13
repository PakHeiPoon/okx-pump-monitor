"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSourceMeta } from "@/lib/source-meta";
import type { Signal } from "@/lib/types";

interface SignalsTableProps {
  signals: Signal[];
}

function ageSeconds(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
}

function timeAgo(iso: string): string {
  const s = ageSeconds(iso);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

type Freshness = "live" | "recent" | "stale";

function freshness(iso: string): Freshness {
  const s = ageSeconds(iso);
  if (s < 5 * 60) return "live";       // <5min
  if (s < 30 * 60) return "recent";    // 5-30min
  return "stale";                       // 30min+
}

function formatVol(v: number): string {
  const n = Number(v);
  if (!n) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function okxTradeUrl(instId: string): string {
  return `https://www.okx.com/trade-swap/${instId.toLowerCase()}`;
}

function formatChange(s: Signal): { text: string; tone: "pump" | "dump" | "neutral" } {
  const chg = Number(s.chg_pct);
  switch (s.source) {
    case "funding_extreme": {
      const rate =
        (s.meta?.funding_rate_pct as number | undefined) ?? chg;
      const sign = rate >= 0 ? "+" : "";
      return {
        text: `${sign}${rate.toFixed(3)}%`,
        tone: rate >= 0 ? "pump" : "dump",
      };
    }
    case "volume_surge": {
      const mult = s.meta?.vol_multiplier as number | undefined;
      return {
        text: mult ? `×${mult.toFixed(1)}` : `${chg.toFixed(2)}%`,
        tone: chg >= 0 ? "pump" : "dump",
      };
    }
    case "breakout":
    case "price_alert": {
      const close = Number(s.close_price);
      const arrow = s.direction === "above" ? "↑" : "↓";
      return {
        text: `${arrow} ${close.toPrecision(5)}`,
        tone: s.direction === "above" ? "pump" : "dump",
      };
    }
    case "oi_surge": {
      const delta = (s.meta?.delta_pct as number | undefined) ?? chg;
      const sign = delta >= 0 ? "+" : "";
      return {
        text: `${sign}${delta.toFixed(1)}% OI`,
        tone: delta >= 0 ? "pump" : "dump",
      };
    }
    case "perp_premium": {
      const prem = (s.meta?.premium_pct as number | undefined) ?? chg;
      const sign = prem >= 0 ? "+" : "";
      return {
        text: `${sign}${prem.toFixed(3)}%`,
        tone: prem >= 0 ? "pump" : "dump",
      };
    }
    case "new_listings": {
      return { text: "🆕 LIST", tone: "neutral" };
    }
    case "longshort_ratio": {
      const ratio = (s.meta?.ratio as number | undefined) ?? chg;
      return {
        text: `L/S ${ratio.toFixed(2)}`,
        tone: ratio >= 1 ? "pump" : "dump",
      };
    }
    case "liquidations": {
      const total =
        ((s.meta?.long_liq_usd as number | undefined) ?? 0) +
        ((s.meta?.short_liq_usd as number | undefined) ?? 0);
      const fmt =
        total >= 1e9
          ? `$${(total / 1e9).toFixed(2)}B`
          : total >= 1e6
          ? `$${(total / 1e6).toFixed(2)}M`
          : `$${(total / 1e3).toFixed(0)}K`;
      return {
        text: `💀 ${fmt}`,
        tone: s.direction === "pump" ? "pump" : "dump",
      };
    }
    case "cross_exchange": {
      const sp = (s.meta?.spread_pct as number | undefined) ?? chg;
      return {
        text: `🔀 ${sp.toFixed(2)}%`,
        tone: s.direction === "pump" ? "pump" : "dump",
      };
    }
    case "flush_reversal": {
      const rec = (s.meta?.recovery_pct as number | undefined) ?? chg;
      return { text: `🪂 V ${rec.toFixed(0)}%`, tone: "pump" };
    }
    default: {
      const sign = chg >= 0 ? "+" : "";
      return {
        text: `${sign}${chg.toFixed(2)}%`,
        tone: chg >= 0 ? "pump" : "dump",
      };
    }
  }
}

function describeMeta(s: Signal): string | null {
  switch (s.source) {
    case "volume_surge":
      return s.meta?.vol_multiplier
        ? `vol×${(s.meta.vol_multiplier as number).toFixed(1)} baseline=${(s.meta.window_bars as number) ?? 20}m`
        : null;
    case "funding_extreme": {
      const rate = s.meta?.funding_rate_pct as number | undefined;
      if (rate === undefined) return null;
      return rate >= 0 ? "longs paying shorts" : "shorts paying longs";
    }
    case "breakout": {
      const lvl = s.meta?.level_price as number | undefined;
      const label = s.meta?.label as string | undefined;
      if (!lvl) return null;
      return `${label ? `${label} · ` : ""}level ${lvl.toPrecision(5)}`;
    }
    case "price_alert": {
      const tgt = s.meta?.target_price as number | undefined;
      const aType = (s.meta?.alert_type as string | undefined) ?? "alert";
      if (!tgt) return null;
      return `${aType} @ ${tgt.toPrecision(5)}`;
    }
    case "oi_surge": {
      const usd = s.meta?.current_oi_usd as number | undefined;
      if (!usd) return null;
      const fmt = usd >= 1e9 ? `${(usd / 1e9).toFixed(2)}B` :
                  usd >= 1e6 ? `${(usd / 1e6).toFixed(1)}M` :
                  usd >= 1e3 ? `${(usd / 1e3).toFixed(0)}K` :
                  usd.toFixed(0);
      return `OI ≈ $${fmt}`;
    }
    case "perp_premium": {
      const swap = s.meta?.swap_price as number | undefined;
      const spot = s.meta?.spot_price as number | undefined;
      if (!swap || !spot) return null;
      return `swap ${swap.toPrecision(5)} · spot ${spot.toPrecision(5)}`;
    }
    case "new_listings": {
      const last = s.meta?.last_price as number | undefined;
      return last ? `last ${last.toPrecision(5)}` : "first seen";
    }
    case "longshort_ratio": {
      return (s.meta?.bias as string | undefined) ?? null;
    }
    case "liquidations": {
      const longUsd = (s.meta?.long_liq_usd as number | undefined) ?? 0;
      const shortUsd = (s.meta?.short_liq_usd as number | undefined) ?? 0;
      const win = (s.meta?.window_min as number | undefined) ?? 5;
      const cnt = (s.meta?.event_count as number | undefined) ?? 0;
      const fmtUsd = (v: number): string =>
        v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`;
      return `${win}min · ${cnt} ev · L ${fmtUsd(longUsd)}/S ${fmtUsd(shortUsd)}`;
    }
    case "cross_exchange": {
      const maxEx = s.meta?.max_exchange as string | undefined;
      const minEx = s.meta?.min_exchange as string | undefined;
      if (!maxEx || !minEx) return null;
      return `${maxEx} > ${minEx}`;
    }
    case "flush_reversal": {
      const peak = s.meta?.peak_price as number | undefined;
      const drop = s.meta?.drop_pct as number | undefined;
      const vx = s.meta?.vol_multiplier as number | undefined;
      if (!peak || drop === undefined) return null;
      return `peak ${peak.toPrecision(5)} -${drop.toFixed(1)}%  vol×${vx?.toFixed(1) ?? "?"}`;
    }
    default:
      return null;
  }
}

export function SignalsTable({ signals }: SignalsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function jumpToSourceFilter(source: string): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sources", source);
    router.push(`/?${params.toString()}`);
  }

  if (signals.length === 0) {
    return (
      <div className="bg-card border-border flex flex-col items-center justify-center gap-2 rounded-lg border p-12 text-center">
        <div className="text-muted-foreground text-sm">
          No signals match the current filters.
        </div>
        <div className="text-muted-foreground text-xs">
          Try widening the time window or selecting more sources.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border-border overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[150px]">Symbol</TableHead>
            <TableHead className="w-[80px]">Dir</TableHead>
            <TableHead className="w-[100px] text-right">Signal</TableHead>
            <TableHead className="w-[100px] text-right">Vol</TableHead>
            <TableHead className="w-[110px]">Source</TableHead>
            <TableHead>Context</TableHead>
            <TableHead className="w-[70px] text-right">Time</TableHead>
            <TableHead className="w-[40px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signals.map((s, idx) => {
            const pump = s.direction === "pump" || s.direction === "above";
            const sm = getSourceMeta(s.source);
            const chg = formatChange(s);
            const ctx = describeMeta(s);
            const fr = freshness(s.detected_at);
            const isTopLive = idx === 0 && fr === "live";
            return (
              <TableRow
                key={s.id}
                className={`relative transition-all duration-700 hover:bg-accent/30 ${
                  fr === "live"
                    ? "bg-emerald-500/[0.04]"
                    : fr === "stale"
                    ? "opacity-60"
                    : ""
                } ${isTopLive ? "signal-flash" : ""}`}
                style={
                  fr === "live"
                    ? { boxShadow: "inset 3px 0 0 0 rgb(16 185 129)" }
                    : undefined
                }
              >
                <TableCell className="font-mono font-medium">
                  <span className="flex items-center gap-2">
                    {fr === "live" ? (
                      <span className="relative inline-flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                    ) : null}
                    <span className="text-foreground">{s.symbol}</span>
                    <span className="text-muted-foreground text-xs">-USDT</span>
                  </span>
                </TableCell>
                <TableCell>
                  {pump ? (
                    <Badge className="bg-emerald-500/15 text-emerald-400">
                      {s.direction === "above" ? "↑ Above" : "🚀 Pump"}
                    </Badge>
                  ) : (
                    <Badge className="bg-rose-500/15 text-rose-400">
                      {s.direction === "below" ? "↓ Below" : "📉 Dump"}
                    </Badge>
                  )}
                </TableCell>
                <TableCell
                  className={`text-right font-mono font-semibold ${
                    chg.tone === "pump"
                      ? "text-emerald-400"
                      : chg.tone === "dump"
                      ? "text-rose-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {chg.text}
                </TableCell>
                <TableCell className="text-muted-foreground text-right font-mono text-sm">
                  ${formatVol(Number(s.vol_usdt))}
                </TableCell>
                <TableCell>
                  <button
                    onClick={() => jumpToSourceFilter(s.source)}
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors ${sm.badgeClass}`}
                    title={`Filter by ${sm.label}`}
                  >
                    {sm.emoji} {sm.shortLabel}
                  </button>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {ctx ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-right font-mono text-xs">
                  {timeAgo(s.detected_at)}
                </TableCell>
                <TableCell>
                  <a
                    href={okxTradeUrl(s.inst_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground inline-flex"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
