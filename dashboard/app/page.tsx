import { Zap } from "lucide-react";

import { FilterSidebar } from "@/components/filter-sidebar";
import { LiveDot } from "@/components/live-dot";
import { SignalsTable } from "@/components/signals-table";
import { StatBar } from "@/components/stat-bar";
import { WatchlistManager } from "@/components/watchlist-manager";
import { fetchSignals, fetchStats } from "@/lib/supabase";
import type { Signal, StatsBundle, TimeWindow } from "@/lib/types";

type Dir = "pump" | "dump" | "all";

interface PageSearchParams {
  direction?: string;
  window?: string;
  source?: string;
}

function parseDir(v: string | undefined): Dir {
  return v === "pump" || v === "dump" ? v : "all";
}

function parseWindow(v: string | undefined): TimeWindow {
  return v === "1h" || v === "6h" || v === "7d" ? v : "24h";
}

function parseSource(v: string | undefined): string {
  return v && v !== "all" ? v : "all";
}

interface HomePageProps {
  searchParams: Promise<PageSearchParams>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const direction = parseDir(params.direction);
  const window = parseWindow(params.window);
  const source = parseSource(params.source);

  let signals: Signal[] = [];
  let stats: StatsBundle = {
    signals_24h: 0,
    pumps_24h: 0,
    dumps_24h: 0,
    total_vol_usdt: 0,
    avg_pump_pct: 0,
    avg_dump_pct: 0,
  };
  let errorMsg: string | null = null;

  try {
    [signals, stats] = await Promise.all([
      fetchSignals({
        window,
        direction: direction === "all" ? undefined : direction,
        source: source === "all" ? undefined : source,
      }),
      fetchStats(window),
    ]);
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <div className="min-h-screen">
      <header className="border-border bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Zap className="text-primary h-5 w-5" />
            <span className="text-base font-semibold tracking-tight">
              OKX Pump Monitor
            </span>
            <span className="text-muted-foreground ml-2 text-xs">
              Perpetual swap signals
            </span>
          </div>
          <div className="flex items-center gap-3">
            <WatchlistManager />
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <LiveDot />
              <span>Live · scanner every 15min</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {errorMsg ? (
          <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
            Failed to load signals: {errorMsg}
            <div className="text-muted-foreground mt-1 text-xs">
              Check NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
              (locally in .env.local · on Vercel under Project Settings → Environment
              Variables). URL must NOT include /rest/v1 or trailing spaces.
            </div>
          </div>
        ) : null}

        <StatBar stats={stats} />

        <div className="mt-6 flex flex-col gap-4 md:flex-row">
          <FilterSidebar current={{ direction, window, source }} />
          <div className="flex-1">
            <SignalsTable signals={signals} />
          </div>
        </div>
      </main>
    </div>
  );
}
