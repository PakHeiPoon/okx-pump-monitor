import Link from "next/link";
import { TrendingUp, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { fetchSignals } from "@/lib/supabase";
import type { Signal } from "@/lib/types";

export const metadata = {
  title: "Markets · OKX Pump Monitor",
};

export const dynamic = "force-dynamic";

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function okxTradeUrl(instId: string): string {
  return `https://www.okx.com/trade-swap/${instId.toLowerCase()}`;
}

interface LiquidationRow {
  signal: Signal;
  symbol: string;
  long_usd: number;
  short_usd: number;
  total_usd: number;
  count: number;
  direction: "pump" | "dump";
  detected_at: string;
}

function parseLiquidations(signals: Signal[]): LiquidationRow[] {
  return signals.map((s) => {
    const longUsd = Number(s.meta?.long_liq_usd ?? 0);
    const shortUsd = Number(s.meta?.short_liq_usd ?? 0);
    return {
      signal: s,
      symbol: s.symbol,
      long_usd: longUsd,
      short_usd: shortUsd,
      total_usd: longUsd + shortUsd,
      count: Number(s.meta?.event_count ?? s.bars ?? 0),
      direction: (s.direction === "pump" ? "pump" : "dump"),
      detected_at: s.detected_at,
    };
  });
}

interface SpreadRow {
  signal: Signal;
  symbol: string;
  inst_id: string;
  spread_pct: number;
  okx_price: number | null;
  bitget_price: number | null;
  gate_price: number | null;
  max_exchange: string;
  min_exchange: string;
  direction: "pump" | "dump";
  detected_at: string;
}

function parseSpreads(signals: Signal[]): SpreadRow[] {
  return signals.map((s) => ({
    signal: s,
    symbol: s.symbol,
    inst_id: s.inst_id,
    spread_pct: Number(s.meta?.spread_pct ?? s.chg_pct ?? 0),
    okx_price:
      typeof s.meta?.okx_price === "number" ? (s.meta.okx_price as number) : null,
    bitget_price:
      typeof s.meta?.bitget_price === "number"
        ? (s.meta.bitget_price as number)
        : null,
    gate_price:
      typeof s.meta?.gate_price === "number" ? (s.meta.gate_price as number) : null,
    max_exchange: (s.meta?.max_exchange as string | undefined) ?? "?",
    min_exchange: (s.meta?.min_exchange as string | undefined) ?? "?",
    direction: (s.direction === "pump" ? "pump" : "dump"),
    detected_at: s.detected_at,
  }));
}

export default async function MarketsPage() {
  let liqSignals: Signal[] = [];
  let spreadSignals: Signal[] = [];
  let errorMsg: string | null = null;

  try {
    [liqSignals, spreadSignals] = await Promise.all([
      fetchSignals({ window: "24h", sources: ["liquidations"], limit: 100 }),
      fetchSignals({ window: "24h", sources: ["cross_exchange"], limit: 100 }),
    ]);
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : "unknown error";
  }

  const liq = parseLiquidations(liqSignals);
  const spreads = parseSpreads(spreadSignals);

  const totalLiqUsd = liq.reduce((acc, r) => acc + r.total_usd, 0);
  const longLiqUsd = liq.reduce((acc, r) => acc + r.long_usd, 0);
  const shortLiqUsd = liq.reduce((acc, r) => acc + r.short_usd, 0);
  const dominant: "long" | "short" | "balanced" =
    longLiqUsd > shortLiqUsd * 1.2
      ? "long"
      : shortLiqUsd > longLiqUsd * 1.2
      ? "short"
      : "balanced";

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="bg-accent/50 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
          <TrendingUp className="text-primary h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              Markets
            </h1>
            <Badge
              variant="outline"
              className="border-orange-500/40 bg-orange-500/10 text-orange-300"
            >
              live · OKX + Bitget + Gate.io
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            爆仓流 + 跨所价差 · 单一交易所是噪音，多所同向才是真信号 ·{" "}
            <Link
              href="/?sources=liquidations,cross_exchange"
              className="text-primary hover:underline"
            >
              主信号流过滤 →
            </Link>
          </p>
        </div>
      </div>

      {errorMsg ? (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          Failed to load market signals: {errorMsg}
        </div>
      ) : null}

      {/* KPI bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="24h 强平总额" value={formatUsd(totalLiqUsd)} />
        <KPI
          label="多头爆仓"
          value={formatUsd(longLiqUsd)}
          tone="dump"
        />
        <KPI
          label="空头爆仓"
          value={formatUsd(shortLiqUsd)}
          tone="pump"
        />
        <KPI
          label="主导方向"
          value={
            dominant === "long"
              ? "💀 多头被杀"
              : dominant === "short"
              ? "🚀 空头被杀"
              : "⚖️ 均衡"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* LEFT: liquidations */}
        <section>
          <h2 className="text-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
            💀 强平爆仓流 (24h)
          </h2>
          {liq.length === 0 ? (
            <EmptyBlock text="24h 内无累计 ≥ $1M 的强平信号（市场平静中）" />
          ) : (
            <div className="bg-card border-border overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-accent/30 border-border border-b">
                  <tr className="text-muted-foreground text-[11px] uppercase">
                    <th className="px-3 py-2 text-left">Coin</th>
                    <th className="px-3 py-2 text-right">Long liq</th>
                    <th className="px-3 py-2 text-right">Short liq</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {liq.slice(0, 25).map((r) => (
                    <LiquidationRow key={r.signal.id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* RIGHT: cross-exchange spreads */}
        <section>
          <h2 className="text-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
            🔀 跨所价差 (24h)
          </h2>
          {spreads.length === 0 ? (
            <EmptyBlock text="24h 内无 ≥ 0.3% 跨所价差信号（市场套利者勤奋中）" />
          ) : (
            <div className="bg-card border-border overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-accent/30 border-border border-b">
                  <tr className="text-muted-foreground text-[11px] uppercase">
                    <th className="px-3 py-2 text-left">Coin</th>
                    <th className="px-3 py-2 text-center">Direction</th>
                    <th className="px-3 py-2 text-right">Spread</th>
                    <th className="px-3 py-2 text-center">High → Low</th>
                    <th className="px-3 py-2 text-right">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {spreads.slice(0, 25).map((r) => (
                    <SpreadRow key={r.signal.id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="text-muted-foreground mt-8 text-xs">
        Data: OKX liquidation-orders · Bitget USDT-FUTURES + Gate.io perp tickers ·
        scanner/monitors/liquidations.py + scanner/monitors/cross_exchange.py · 15min cron
        <br />
        逻辑：多头爆仓 → 抛压；空头爆仓 → 轧空。OKX 偏高 = 领涨；偏低 = 滞涨。
      </div>
    </main>
  );
}

function LiquidationRow({ row: r }: { row: LiquidationRow }) {
  const dominantLong = r.long_usd > r.short_usd;
  return (
    <tr className="border-border/50 hover:bg-accent/20 border-b last:border-b-0">
      <td className="px-3 py-2 font-mono text-xs font-semibold">
        <a
          href={okxTradeUrl(r.signal.inst_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary inline-flex items-center gap-1"
        >
          {r.symbol}
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </td>
      <td
        className={`px-3 py-2 text-right font-mono text-xs ${
          dominantLong ? "font-semibold text-rose-300" : "text-muted-foreground"
        }`}
      >
        {formatUsd(r.long_usd)}
      </td>
      <td
        className={`px-3 py-2 text-right font-mono text-xs ${
          !dominantLong ? "font-semibold text-emerald-300" : "text-muted-foreground"
        }`}
      >
        {formatUsd(r.short_usd)}
      </td>
      <td className="text-foreground px-3 py-2 text-right font-mono text-xs font-semibold">
        {formatUsd(r.total_usd)}
      </td>
      <td className="text-muted-foreground px-3 py-2 text-right font-mono text-[11px]">
        {timeAgo(r.detected_at)}
      </td>
    </tr>
  );
}

function SpreadRow({ row: r }: { row: SpreadRow }) {
  const tone = r.direction === "pump" ? "text-emerald-400" : "text-rose-400";
  return (
    <tr className="border-border/50 hover:bg-accent/20 border-b last:border-b-0">
      <td className="px-3 py-2 font-mono text-xs font-semibold">
        <a
          href={okxTradeUrl(r.inst_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary inline-flex items-center gap-1"
        >
          {r.symbol}
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </td>
      <td className="px-3 py-2 text-center">
        {r.direction === "pump" ? (
          <Badge className="bg-emerald-500/15 text-emerald-400 text-[10px]">
            🚀 OKX 领涨
          </Badge>
        ) : (
          <Badge className="bg-rose-500/15 text-rose-400 text-[10px]">
            📉 OKX 滞涨
          </Badge>
        )}
      </td>
      <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${tone}`}>
        {r.spread_pct.toFixed(2)}%
      </td>
      <td className="text-muted-foreground px-3 py-2 text-center font-mono text-[11px]">
        {r.max_exchange} → {r.min_exchange}
      </td>
      <td className="text-muted-foreground px-3 py-2 text-right font-mono text-[11px]">
        {timeAgo(r.detected_at)}
      </td>
    </tr>
  );
}

function KPI({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pump" | "dump";
}) {
  const color =
    tone === "pump"
      ? "text-emerald-400"
      : tone === "dump"
      ? "text-rose-400"
      : "text-foreground";
  return (
    <div className="bg-card border-border rounded-lg border p-3">
      <div className="text-muted-foreground text-[10px] uppercase tracking-wider">
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold ${color}`}>
        {value}
      </div>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="bg-card border-border flex items-center justify-center rounded-lg border p-10 text-center">
      <span className="text-muted-foreground text-sm">{text}</span>
    </div>
  );
}
