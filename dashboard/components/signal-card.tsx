"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { getSourceMeta } from "@/lib/source-meta";
import type { Signal } from "@/lib/types";

interface SignalCardProps {
  signal: Signal;
  // Future Tier-2 prop. When backend signal fusion lands, related[] holds the
  // OTHER monitor signals that fired on the same inst_id within the fusion
  // window. For now always empty — the card still renders the single-source
  // shape correctly.
  related?: ReadonlyArray<Signal>;
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
  if (s < 5 * 60) return "live";
  if (s < 30 * 60) return "recent";
  return "stale";
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

interface ChangeDisplay {
  text: string;
  tone: "pump" | "dump" | "neutral";
}

function formatChange(s: Signal): ChangeDisplay {
  const chg = Number(s.chg_pct);
  switch (s.source) {
    case "funding_extreme": {
      const rate = (s.meta?.funding_rate_pct as number | undefined) ?? chg;
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
      return {
        text: `🪂 V ${rec.toFixed(0)}%`,
        tone: "pump",
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
        ? `vol×${(s.meta.vol_multiplier as number).toFixed(1)} · baseline ${
            (s.meta.window_bars as number) ?? 20
          }m`
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
      const fmt =
        usd >= 1e9
          ? `${(usd / 1e9).toFixed(2)}B`
          : usd >= 1e6
          ? `${(usd / 1e6).toFixed(1)}M`
          : usd >= 1e3
          ? `${(usd / 1e3).toFixed(0)}K`
          : usd.toFixed(0);
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
        v >= 1e6
          ? `$${(v / 1e6).toFixed(1)}M`
          : v >= 1e3
          ? `$${(v / 1e3).toFixed(0)}K`
          : `$${v.toFixed(0)}`;
      return `${win}min · ${cnt} events · L ${fmtUsd(longUsd)} / S ${fmtUsd(shortUsd)}`;
    }
    case "cross_exchange": {
      const maxEx = s.meta?.max_exchange as string | undefined;
      const minEx = s.meta?.min_exchange as string | undefined;
      if (!maxEx || !minEx) return null;
      return `${maxEx} > ${minEx}`;
    }
    case "flush_reversal": {
      const peak = s.meta?.peak_price as number | undefined;
      const trough = s.meta?.trough_price as number | undefined;
      const drop = s.meta?.drop_pct as number | undefined;
      const pt = s.meta?.peak_trough_min as number | undefined;
      const vx = s.meta?.vol_multiplier as number | undefined;
      if (!peak || !trough) return null;
      const dropStr = drop !== undefined ? `-${drop.toFixed(1)}%` : "?";
      const ptStr = pt !== undefined ? `${pt}min` : "?";
      const vxStr = vx !== undefined ? `${vx.toFixed(1)}×` : "?";
      return `${peak.toPrecision(5)} → ${trough.toPrecision(5)} (${dropStr} in ${ptStr}) · vol ${vxStr}`;
    }
    default:
      return null;
  }
}

// Confidence is the fusion score: 1-5 stars based on how many distinct monitor
// sources fired on the same inst_id within the fusion window. Phase 1 stub —
// always uses (1 + related.length) capped at 5. When backend fusion ships, this
// becomes a server-computed field on the Signal row.
function computeConfidence(related?: ReadonlyArray<Signal>): number {
  const distinctSources = new Set<string>(
    (related ?? []).map((r) => r.source),
  );
  return Math.min(5, 1 + distinctSources.size);
}

export function SignalCard({ signal: s, related }: SignalCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const chg = formatChange(s);
  const ctx = describeMeta(s);
  const fr = freshness(s.detected_at);
  const pump = s.direction === "pump" || s.direction === "above";
  const confidence = computeConfidence(related);

  function jumpToSourceFilter(source: string): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sources", source);
    router.push(`/?${params.toString()}`);
  }

  const allSources = [s, ...(related ?? [])].reduce<string[]>((acc, sig) => {
    if (!acc.includes(sig.source)) acc.push(sig.source);
    return acc;
  }, []);

  return (
    <article
      className={`group bg-card border-border relative overflow-hidden rounded-lg border p-4 transition-all hover:border-accent-foreground/20 ${
        fr === "live" ? "bg-emerald-500/[0.03]" : fr === "stale" ? "opacity-60" : ""
      }`}
      style={
        fr === "live"
          ? { boxShadow: "inset 3px 0 0 0 rgb(16 185 129)" }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-3">
        {/* LEFT: symbol + direction + price change */}
        <div className="flex flex-1 items-start gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {fr === "live" ? (
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
              ) : null}
              <span className="text-foreground font-mono text-sm font-semibold">
                {s.symbol}
              </span>
              <span className="text-muted-foreground text-[10px]">-USDT</span>
              {pump ? (
                <Badge className="bg-emerald-500/15 text-emerald-400 text-[10px] py-0">
                  {s.direction === "above" ? "↑ Above" : "🚀 Pump"}
                </Badge>
              ) : (
                <Badge className="bg-rose-500/15 text-rose-400 text-[10px] py-0">
                  {s.direction === "below" ? "↓ Below" : "📉 Dump"}
                </Badge>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className={`font-mono text-2xl font-bold leading-none ${
                  chg.tone === "pump"
                    ? "text-emerald-400"
                    : chg.tone === "dump"
                    ? "text-rose-400"
                    : "text-foreground"
                }`}
              >
                {chg.text}
              </span>
              <span className="text-muted-foreground font-mono text-xs">
                ${formatVol(Number(s.vol_usdt))}
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT: confidence + time + actions */}
        <div className="flex flex-col items-end gap-1.5">
          <div
            className="flex items-center gap-0.5"
            title={`Confidence ${confidence}/5 — ${allSources.length} monitor(s) agree`}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`h-3 w-3 ${
                  i < confidence
                    ? "fill-amber-400 text-amber-400"
                    : "text-muted-foreground/30"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground font-mono text-[11px]">
              {timeAgo(s.detected_at)}
            </span>
            <a
              href={okxTradeUrl(s.inst_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex"
              title="Open in OKX"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Source chips row */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {allSources.map((src) => {
          const meta = getSourceMeta(src);
          return (
            <button
              key={src}
              onClick={() => jumpToSourceFilter(src)}
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors ${meta.badgeClass}`}
              title={`Filter by ${meta.label}`}
            >
              {meta.emoji} {meta.shortLabel}
            </button>
          );
        })}
        {ctx ? (
          <span className="text-muted-foreground ml-1 text-[11px]">· {ctx}</span>
        ) : null}
      </div>
    </article>
  );
}
