import Link from "next/link";
import { Coins, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { fetchSignals } from "@/lib/supabase";
import type { Signal } from "@/lib/types";

export const metadata = {
  title: "Onchain · OKX Pump Monitor",
};

interface WhaleTx {
  hash: string;
  value_usd: number;
  ts: number;
  token: string;
  from: string;
}

interface ExchangeAgg {
  exchange: string;
  total_usd: number;
  tx_count: number;
  max_single_usd: number;
  latest_ts: number;
  latest_signal_id: number;
  signals: Signal[];
}

interface RecentTx extends WhaleTx {
  exchange: string;
}

function aggregateByExchange(signals: Signal[]): ExchangeAgg[] {
  const buckets = new Map<string, ExchangeAgg>();
  for (const s of signals) {
    const ex = (s.meta?.exchange as string | undefined) ?? "?";
    const ts = new Date(s.detected_at).getTime();
    const existing = buckets.get(ex);
    if (existing) {
      existing.total_usd += Number(s.meta?.total_usd ?? 0);
      existing.tx_count += Number(s.meta?.tx_count ?? 0);
      existing.max_single_usd = Math.max(
        existing.max_single_usd,
        Number(s.meta?.max_single_usd ?? 0),
      );
      if (ts > existing.latest_ts) {
        existing.latest_ts = ts;
        existing.latest_signal_id = s.id;
      }
      existing.signals.push(s);
    } else {
      buckets.set(ex, {
        exchange: ex,
        total_usd: Number(s.meta?.total_usd ?? 0),
        tx_count: Number(s.meta?.tx_count ?? 0),
        max_single_usd: Number(s.meta?.max_single_usd ?? 0),
        latest_ts: ts,
        latest_signal_id: s.id,
        signals: [s],
      });
    }
  }
  return Array.from(buckets.values()).sort((a, b) => b.total_usd - a.total_usd);
}

function recentTransfers(signals: Signal[], limit: number = 20): RecentTx[] {
  const txs: RecentTx[] = [];
  for (const s of signals) {
    const ex = (s.meta?.exchange as string | undefined) ?? "?";
    const topTxs = (s.meta?.top_txs as WhaleTx[] | undefined) ?? [];
    for (const tx of topTxs) {
      txs.push({ ...tx, exchange: ex });
    }
  }
  txs.sort((a, b) => b.ts - a.ts);
  return txs.slice(0, limit);
}

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function timeAgoFromMs(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function timeAgoIso(iso: string): string {
  return timeAgoFromMs(new Date(iso).getTime());
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function etherscanTxUrl(hash: string): string {
  return `https://etherscan.io/tx/${hash}`;
}

const EXCHANGE_COLOR: Record<string, string> = {
  Binance:   "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  Binance2:  "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  Binance3:  "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  Coinbase:  "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Coinbase2: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  OKX:       "bg-purple-500/15 text-purple-300 border-purple-500/30",
  Kraken:    "bg-pink-500/15 text-pink-300 border-pink-500/30",
  Bybit:     "bg-orange-500/15 text-orange-300 border-orange-500/30",
};

function exchangeBadgeClass(name: string): string {
  return (
    EXCHANGE_COLOR[name] ??
    "bg-zinc-500/15 text-zinc-300 border-zinc-500/30"
  );
}

export default async function OnchainPage() {
  let signals: Signal[] = [];
  let errorMsg: string | null = null;

  try {
    signals = await fetchSignals({
      window: "24h",
      sources: ["whale_to_cex"],
      limit: 200,
    });
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : "unknown error";
  }

  const exchanges = aggregateByExchange(signals);
  const recent = recentTransfers(signals, 25);
  const totalInflow24h = exchanges.reduce((acc, e) => acc + e.total_usd, 0);
  const totalTxs24h = exchanges.reduce((acc, e) => acc + e.tx_count, 0);
  const maxSingle24h = exchanges.reduce(
    (acc, e) => Math.max(acc, e.max_single_usd),
    0,
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <div className="bg-accent/50 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
          <Coins className="text-primary h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              Whale → CEX
            </h1>
            <Badge
              variant="outline"
              className="border-indigo-500/40 bg-indigo-500/10 text-indigo-300"
            >
              live · Etherscan
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            USDT/USDC 大额转入 8 个 CEX 热钱包 · 24h 窗口 ·{" "}
            <Link
              href="/?sources=whale_to_cex"
              className="text-primary hover:underline"
            >
              在主信号流过滤 whale_to_cex →
            </Link>
          </p>
        </div>
      </div>

      {errorMsg ? (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          Failed to load whale signals: {errorMsg}
        </div>
      ) : null}

      {/* KPI bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="24h 总流入" value={formatUsd(totalInflow24h)} />
        <KPI label="24h 转账笔数" value={String(totalTxs24h)} />
        <KPI label="单笔最大" value={formatUsd(maxSingle24h)} />
        <KPI label="活跃 CEX" value={`${exchanges.length} / 8`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* LEFT: per-exchange breakdown */}
        <section>
          <h2 className="text-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
            🏦 各交易所流入排行
          </h2>
          {exchanges.length === 0 ? (
            <EmptyBlock text="24h 内无大额转入信号（阈值未触发）" />
          ) : (
            <div className="space-y-2">
              {exchanges.map((ex) => (
                <ExchangeCard key={ex.exchange} agg={ex} />
              ))}
            </div>
          )}
        </section>

        {/* RIGHT: recent transfer stream */}
        <section>
          <h2 className="text-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
            ⚡ 最近大额转账
          </h2>
          {recent.length === 0 ? (
            <EmptyBlock text="24h 内无单笔大额转账" />
          ) : (
            <div className="bg-card border-border overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-accent/30 border-border border-b">
                  <tr className="text-muted-foreground text-[11px] uppercase">
                    <th className="px-3 py-2 text-left">CEX</th>
                    <th className="px-3 py-2 text-left">Token</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2 text-left">From</th>
                    <th className="px-3 py-2 text-right">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((tx) => (
                    <tr
                      key={tx.hash}
                      className="border-border/50 hover:bg-accent/20 border-b last:border-b-0"
                    >
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${exchangeBadgeClass(
                            tx.exchange,
                          )}`}
                        >
                          {tx.exchange}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                        {tx.token}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-rose-300">
                        {formatUsd(tx.value_usd)}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 font-mono text-[11px]">
                        {shortAddr(tx.from)}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-right font-mono text-[11px]">
                        <a
                          href={etherscanTxUrl(tx.hash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-foreground inline-flex items-center gap-1"
                          title="Open in Etherscan"
                        >
                          {timeAgoFromMs(tx.ts * 1000)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="text-muted-foreground mt-8 text-xs">
        Data sources: Etherscan V2 API · monitor scanner/monitors/whale_to_cex.py · 15min cron
        <br />
        Note: 大额转入 ≠ 即刻砸盘——Tether mint 给 Binance treasury 不进市场。结合其他维度信号判断。
      </div>
    </main>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border-border rounded-lg border p-3">
      <div className="text-muted-foreground text-[10px] uppercase tracking-wider">
        {label}
      </div>
      <div className="text-foreground mt-1 font-mono text-lg font-semibold">
        {value}
      </div>
    </div>
  );
}

function ExchangeCard({ agg }: { agg: ExchangeAgg }) {
  return (
    <div className="bg-card border-border flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors hover:border-accent-foreground/20">
      <div className="flex items-center gap-3">
        <span
          className={`rounded-md border px-2 py-1 text-xs font-semibold ${exchangeBadgeClass(
            agg.exchange,
          )}`}
        >
          {agg.exchange}
        </span>
        <div>
          <div className="text-muted-foreground text-[11px]">
            {agg.tx_count} tx · max {formatUsd(agg.max_single_usd)} · {timeAgoFromMs(agg.latest_ts)} ago
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-base font-semibold text-rose-300">
          {formatUsd(agg.total_usd)}
        </div>
        <div className="text-muted-foreground text-[10px]">total inflow</div>
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

// signal id stable hint to help dev tooling. Avoid emitting unused warning.
export const dynamic = "force-dynamic";

// keep timeAgoIso reachable for future use（dashboard 后续按 detected_at 排序时需要）
void timeAgoIso;
