import "server-only";

import type { Signal } from "@/lib/types";

/**
 * Port of scanner/backtest/replay.py to TypeScript so the /backtest page
 * can render results server-side without invoking the Python CLI.
 */

const OKX_BASE = "https://www.okx.com";

export interface BacktestRow {
  signal_id: number;
  inst_id: string;
  symbol: string;
  source: string;
  direction: string;
  chg_pct_at_signal: number;
  detected_at: string;
  entry_price: number;
  exit_price: number;
  horizon_return_pct: number;     // signed return
  signed_return_pct: number;       // direction-adjusted: pump→+ if 涨; dump→+ if 跌
  horizon_min: number;
  is_correct: boolean;
  confidence_score: number;
  fused_sources: string[];
}

interface FetchSignalsOpts {
  since_iso: string;
  source?: string;        // "all" or specific
  limit?: number;
}

function supabaseEnv(): { url: string; key: string } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_KEY ?? "").trim();
  if (!url || !key) throw new Error("Supabase env missing");
  return { url, key };
}

export async function fetchSignalsForBacktest(opts: FetchSignalsOpts): Promise<Signal[]> {
  const { url, key } = supabaseEnv();
  const params = new URLSearchParams({
    select: "*",
    detected_at: `gte.${opts.since_iso}`,
    order: "detected_at.asc",
    limit: String(opts.limit ?? 200),
  });
  if (opts.source && opts.source !== "all") {
    params.set("source", `eq.${opts.source}`);
  }
  const res = await fetch(`${url}/rest/v1/signals?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    next: { revalidate: 60 },     // 1min cache, backtest doesn't change THAT often
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as Signal[];
}

async function fetchOkxCandlesWindow(
  inst_id: string,
  anchor_ms: number,
  horizon_min: number,
): Promise<string[][]> {
  const after_ms = anchor_ms + horizon_min * 60_000;
  const params = new URLSearchParams({
    instId: inst_id,
    bar: "1m",
    before: String(anchor_ms - 60_000),
    after: String(after_ms + 60_000),
    limit: String(horizon_min + 2),
  });
  const res = await fetch(`${OKX_BASE}/api/v5/market/history-candles?${params}`, {
    next: { revalidate: 300 },   // 历史数据不变，5min cache 减 OKX 调用
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: string[][]; code?: string };
  if (data.code && data.code !== "0") return [];
  return data.data ?? [];
}

function directionCorrect(direction: string, ret_pct: number): boolean {
  if (direction === "pump" || direction === "above") return ret_pct > 0;
  if (direction === "dump" || direction === "below") return ret_pct < 0;
  return false;
}

async function replayOne(s: Signal, horizon_min: number): Promise<BacktestRow | null> {
  // Skip 合成 inst_id（whale_to_cex 这类没 OKX K 线）
  if (!s.inst_id.endsWith("-USDT-SWAP")) return null;

  const anchor_ms = new Date(s.detected_at).getTime();
  const candles = await fetchOkxCandlesWindow(s.inst_id, anchor_ms, horizon_min);
  if (candles.length < 2) return null;

  // Filter to confirmed bars (idx 8 == "1") + ascending
  const confirmed = candles
    .filter((c) => c.length > 8 && c[8] === "1")
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const post = confirmed.filter((c) => Number(c[0]) >= anchor_ms);
  if (post.length < 2) return null;

  const entry = Number(post[0][1]);   // open
  const exit_p = Number(post[post.length - 1][4]);   // close
  if (entry <= 0) return null;

  const ret_pct = ((exit_p - entry) / entry) * 100;
  const isPositiveDir = s.direction === "pump" || s.direction === "above";
  const signed = isPositiveDir ? ret_pct : -ret_pct;
  const meta = (s.meta ?? {}) as Record<string, unknown>;
  const fused = Array.isArray(meta.fused_sources)
    ? (meta.fused_sources as string[])
    : [];

  return {
    signal_id: s.id,
    inst_id: s.inst_id,
    symbol: s.symbol,
    source: s.source,
    direction: s.direction,
    chg_pct_at_signal: Number(s.chg_pct) || 0,
    detected_at: s.detected_at,
    entry_price: entry,
    exit_price: exit_p,
    horizon_return_pct: Math.round(ret_pct * 10000) / 10000,
    signed_return_pct: Math.round(signed * 10000) / 10000,
    horizon_min,
    is_correct: directionCorrect(s.direction, ret_pct),
    confidence_score: Number(meta.confidence_score ?? 1),
    fused_sources: fused,
  };
}

export async function replayAll(
  signals: Signal[],
  horizon_min: number = 15,
  concurrency: number = 8,
): Promise<BacktestRow[]> {
  // Concurrency-limited promise pool (OKX 限 ~10 req/sec)
  const results: BacktestRow[] = [];
  let i = 0;
  async function worker() {
    while (i < signals.length) {
      const idx = i++;
      try {
        const row = await replayOne(signals[idx], horizon_min);
        if (row) results.push(row);
      } catch {
        // OKX fetch / 解析失败时跳过此 signal — page level KPI 会显示 skip 数
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export interface AggRow {
  key: string;
  n: number;
  hit_pct: number;
  avg_signed: number;
  median_signed: number;
  best_signed: number;
  worst_signed: number;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function aggregate(rows: BacktestRow[], keyFn: (r: BacktestRow) => string): AggRow[] {
  const buckets = new Map<string, BacktestRow[]>();
  for (const r of rows) {
    const k = keyFn(r);
    const arr = buckets.get(k) ?? [];
    arr.push(r);
    buckets.set(k, arr);
  }
  const out: AggRow[] = [];
  for (const [key, rs] of buckets) {
    const signed = rs.map((r) => r.signed_return_pct);
    const hits = rs.filter((r) => r.is_correct).length;
    out.push({
      key,
      n: rs.length,
      hit_pct: (hits / rs.length) * 100,
      avg_signed: signed.reduce((a, b) => a + b, 0) / signed.length,
      median_signed: median(signed),
      best_signed: Math.max(...signed),
      worst_signed: Math.min(...signed),
    });
  }
  out.sort((a, b) => b.n - a.n);
  return out;
}
