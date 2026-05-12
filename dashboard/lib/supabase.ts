import type { Signal, StatsBundle, TimeWindow } from "./types";

function normalizeSupabaseUrl(raw: string): string {
  // 容错：trim 空格、去尾斜杠、去用户可能误粘的 /rest/v1[/] 后缀
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1\/?$/i, "");
}

const SUPABASE_URL = normalizeSupabaseUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
);
const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

function ensureConfigured(): void {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "Supabase env not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (locally in .env.local, on Vercel under Project → Settings → Environment Variables).",
    );
  }
}

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

function windowToHours(w: TimeWindow): number {
  switch (w) {
    case "1h":
      return 1;
    case "6h":
      return 6;
    case "24h":
      return 24;
    case "7d":
      return 168;
  }
}

function sinceIso(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

interface FetchSignalsOpts {
  window: TimeWindow;
  direction?: "pump" | "dump";
  source?: string;
  limit?: number;
}

export async function fetchSignals(opts: FetchSignalsOpts): Promise<Signal[]> {
  ensureConfigured();
  const hours = windowToHours(opts.window);
  const since = sinceIso(hours);
  const limit = opts.limit ?? 200;

  const params = new URLSearchParams({
    select: "*",
    order: "detected_at.desc",
    limit: String(limit),
    detected_at: `gte.${since}`,
  });
  if (opts.direction) {
    params.set("direction", `eq.${opts.direction}`);
  }
  if (opts.source) {
    params.set("source", `eq.${opts.source}`);
  }

  const url = `${SUPABASE_URL}/rest/v1/signals?${params.toString()}`;
  const res = await fetch(url, {
    headers: headers(),
    next: { revalidate: 10 },
  });
  if (!res.ok) {
    throw new Error(`Supabase fetchSignals failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as Signal[];
}

export async function fetchStats(window: TimeWindow): Promise<StatsBundle> {
  const signals = await fetchSignals({ window, limit: 1000 });
  const pumps = signals.filter((s) => s.direction === "pump");
  const dumps = signals.filter((s) => s.direction === "dump");
  const totalVol = signals.reduce((acc, s) => acc + Number(s.vol_usdt), 0);
  const avgPump =
    pumps.length === 0
      ? 0
      : pumps.reduce((a, s) => a + Number(s.chg_pct), 0) / pumps.length;
  const avgDump =
    dumps.length === 0
      ? 0
      : dumps.reduce((a, s) => a + Number(s.chg_pct), 0) / dumps.length;

  // Most active coin
  const hitsBySymbol = new Map<string, number>();
  for (const s of signals) {
    hitsBySymbol.set(s.symbol, (hitsBySymbol.get(s.symbol) ?? 0) + 1);
  }
  let topCoin: StatsBundle["top_coin"];
  for (const [symbol, hits] of hitsBySymbol) {
    if (!topCoin || hits > topCoin.hits) {
      topCoin = { symbol, hits };
    }
  }

  return {
    signals_24h: signals.length,
    pumps_24h: pumps.length,
    dumps_24h: dumps.length,
    total_vol_usdt: totalVol,
    avg_pump_pct: Math.round(avgPump * 100) / 100,
    avg_dump_pct: Math.round(avgDump * 100) / 100,
    top_coin: topCoin,
  };
}
