import Link from "next/link";
import { Sparkles, ExternalLink, TrendingUp, TrendingDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { fetchSignals } from "@/lib/supabase";
import type { Signal } from "@/lib/types";

export const metadata = {
  title: "Social · OKX Pump Monitor",
};

export const dynamic = "force-dynamic";

interface TrendingEntry {
  symbol: string;
  inst_id: string;
  coin_name: string;
  market_cap_rank: number | null;
  price_change_24h_pct: number;
  detected_at: string;
  signal_id: number;
}

function pickEntries(signals: Signal[]): TrendingEntry[] {
  // 同币种保留最新一条（detected_at 最大）。signals 已 detected_at desc 排序。
  const seen = new Set<string>();
  const out: TrendingEntry[] = [];
  for (const s of signals) {
    if (seen.has(s.symbol)) continue;
    seen.add(s.symbol);
    out.push({
      symbol: s.symbol,
      inst_id: s.inst_id,
      coin_name: (s.meta?.coin_name as string | undefined) ?? s.symbol,
      market_cap_rank:
        typeof s.meta?.market_cap_rank === "number"
          ? (s.meta.market_cap_rank as number)
          : null,
      price_change_24h_pct:
        Number(s.meta?.price_change_24h_pct ?? s.chg_pct) || 0,
      detected_at: s.detected_at,
      signal_id: s.id,
    });
  }
  return out;
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

function isFreshlyEntered(iso: string): boolean {
  // 最近 1h 内首次进入 = "NEW"
  const ageMs = Date.now() - new Date(iso).getTime();
  return ageMs < 60 * 60 * 1000;
}

function okxTradeUrl(instId: string): string {
  return `https://www.okx.com/trade-swap/${instId.toLowerCase()}`;
}

function coinGeckoUrl(symbol: string): string {
  return `https://www.coingecko.com/en/coins/${symbol.toLowerCase()}`;
}

export default async function SocialPage() {
  let signals: Signal[] = [];
  let errorMsg: string | null = null;

  try {
    signals = await fetchSignals({
      window: "24h",
      sources: ["social_surge"],
      limit: 200,
    });
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : "unknown error";
  }

  const entries = pickEntries(signals);
  const fresh = entries.filter((e) => isFreshlyEntered(e.detected_at));
  const pumps = entries.filter((e) => e.price_change_24h_pct > 0);
  const dumps = entries.filter((e) => e.price_change_24h_pct < 0);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <div className="bg-accent/50 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
          <Sparkles className="text-primary h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              Social Surge
            </h1>
            <Badge
              variant="outline"
              className="border-sky-500/40 bg-sky-500/10 text-sky-300"
            >
              live · CoinGecko trending
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            首次进入 CoinGecko 24h 全球热搜的币种 · 在 OKX 有对应 SWAP 才显示 ·{" "}
            <Link
              href="/?sources=social_surge"
              className="text-primary hover:underline"
            >
              在主信号流过滤 social_surge →
            </Link>
          </p>
        </div>
      </div>

      {errorMsg ? (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          Failed to load social signals: {errorMsg}
        </div>
      ) : null}

      {/* KPI bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="24h 进榜币种" value={String(entries.length)} />
        <KPI label="最近 1h 新进" value={String(fresh.length)} accent={fresh.length > 0} />
        <KPI label="24h 上涨" value={String(pumps.length)} tone="pump" />
        <KPI label="24h 下跌" value={String(dumps.length)} tone="dump" />
      </div>

      {/* Trending grid */}
      <section>
        <h2 className="text-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
          🌐 24h 进榜（按发现时间，新→旧）
        </h2>
        {entries.length === 0 ? (
          <div className="bg-card border-border flex items-center justify-center rounded-lg border p-10 text-center">
            <span className="text-muted-foreground text-sm">
              24h 内无新币种进入 CoinGecko 热搜
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {entries.map((e) => (
              <TrendingCard key={e.signal_id} entry={e} />
            ))}
          </div>
        )}
      </section>

      <div className="text-muted-foreground mt-8 text-xs">
        Data source: CoinGecko `/search/trending` · monitor scanner/monitors/social_surge.py · 15min cron
        <br />
        逻辑：每轮拉热搜榜 vs 上轮 state · 只对**新进入**的 OKX 可交易币种发信号
      </div>
    </main>
  );
}

interface TrendingCardProps {
  entry: TrendingEntry;
}

function TrendingCard({ entry: e }: TrendingCardProps) {
  const fresh = isFreshlyEntered(e.detected_at);
  const isPump = e.price_change_24h_pct > 0;
  const chgColor = isPump ? "text-emerald-400" : "text-rose-400";
  const Arrow = isPump ? TrendingUp : TrendingDown;
  const sign = isPump ? "+" : "";

  return (
    <div
      className={`bg-card border-border relative overflow-hidden rounded-lg border p-3 transition-all hover:border-accent-foreground/20 ${
        fresh ? "ring-1 ring-sky-500/40 bg-sky-500/[0.03]" : ""
      }`}
    >
      {fresh ? (
        <span className="absolute right-2 top-2 rounded-md bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-300">
          new
        </span>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-foreground truncate font-mono text-sm font-semibold">
            {e.symbol}
          </div>
          <div className="text-muted-foreground truncate text-[11px]">
            {e.coin_name}
          </div>
        </div>
        {e.market_cap_rank !== null ? (
          <span className="text-muted-foreground bg-accent/40 rounded px-1.5 py-0.5 font-mono text-[10px]">
            #{e.market_cap_rank}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className={`flex items-center gap-1 font-mono text-sm ${chgColor}`}>
          <Arrow className="h-3 w-3" />
          <span>{sign}{e.price_change_24h_pct.toFixed(2)}%</span>
        </div>
        <div className="text-muted-foreground font-mono text-[10px]">
          {timeAgo(e.detected_at)} ago
        </div>
      </div>

      <div className="border-border/60 mt-2 flex items-center justify-between gap-2 border-t pt-2">
        <a
          href={coinGeckoUrl(e.symbol)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[10px]"
        >
          CoinGecko <ExternalLink className="h-2.5 w-2.5" />
        </a>
        <a
          href={okxTradeUrl(e.inst_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-1 text-[10px]"
        >
          OKX trade <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}

interface KPIProps {
  label: string;
  value: string;
  tone?: "pump" | "dump";
  accent?: boolean;
}

function KPI({ label, value, tone, accent }: KPIProps) {
  const color =
    tone === "pump"
      ? "text-emerald-400"
      : tone === "dump"
      ? "text-rose-400"
      : "text-foreground";
  return (
    <div
      className={`bg-card border-border rounded-lg border p-3 ${
        accent ? "ring-1 ring-sky-500/40" : ""
      }`}
    >
      <div className="text-muted-foreground text-[10px] uppercase tracking-wider">
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold ${color}`}>
        {value}
      </div>
    </div>
  );
}
