"use client";

import { useEffect, useMemo, useState } from "react";

import { getSourceMeta } from "@/lib/source-meta";
import type { Signal } from "@/lib/types";

interface SignalsTickerProps {
  signals: Signal[];
}

function describe(s: Signal): string {
  const sm = getSourceMeta(s.source);
  const sign =
    s.direction === "pump" || s.direction === "above" ? "+" : "";
  return `${sm.emoji} ${s.symbol} ${sign}${Number(s.chg_pct).toFixed(2)}%`;
}

function tone(direction: Signal["direction"]): string {
  return direction === "pump" || direction === "above"
    ? "text-emerald-400"
    : "text-rose-400";
}

export function SignalsTicker({ signals }: SignalsTickerProps) {
  const latest = useMemo(() => signals.slice(0, 12), [signals]);

  // Pulse the latest item when its id changes
  const [pulseId, setPulseId] = useState<number | null>(null);
  useEffect(() => {
    if (!latest[0]) return;
    setPulseId(latest[0].id);
    const t = setTimeout(() => setPulseId(null), 1200);
    return () => clearTimeout(t);
  }, [latest[0]?.id]);

  if (latest.length === 0) return null;

  // Duplicate items for seamless loop
  const items = [...latest, ...latest];

  return (
    <div className="border-border bg-card/50 relative overflow-hidden rounded-md border">
      <div className="from-card pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r to-transparent" />
      <div className="from-card pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l to-transparent" />
      <div className="ticker-scroll flex gap-6 whitespace-nowrap py-1.5 font-mono text-xs">
        {items.map((s, idx) => {
          const isFreshHead = idx === 0 && pulseId === s.id;
          return (
            <span
              key={`${s.id}-${idx}`}
              className={`shrink-0 ${tone(s.direction)} ${
                isFreshHead ? "animate-pulse font-semibold" : ""
              }`}
            >
              {describe(s)}
            </span>
          );
        })}
      </div>
      <style>{`
        @keyframes ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-scroll {
          animation: ticker 60s linear infinite;
          will-change: transform;
        }
        .ticker-scroll:hover { animation-play-state: paused; }
      `}</style>
    </div>
  );
}
