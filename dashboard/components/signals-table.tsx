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

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
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
      const open = Number(s.open_price);
      const close = Number(s.close_price);
      const arrow = s.direction === "above" ? "↑" : "↓";
      return {
        text: `${arrow} ${close.toPrecision(5)}`,
        tone: s.direction === "above" ? "pump" : "dump",
      };
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
          {signals.map((s) => {
            const pump = s.direction === "pump" || s.direction === "above";
            const sm = getSourceMeta(s.source);
            const chg = formatChange(s);
            const ctx = describeMeta(s);
            return (
              <TableRow key={s.id} className="hover:bg-accent/30">
                <TableCell className="font-mono font-medium">
                  <span className="text-foreground">{s.symbol}</span>
                  <span className="text-muted-foreground ml-1 text-xs">-USDT</span>
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
