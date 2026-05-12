import { Zap } from "lucide-react";

import { FilterSidebar } from "@/components/filter-sidebar";
import { SignalsLive } from "@/components/signals-live";
import { StatBar } from "@/components/stat-bar";
import { WatchlistManager } from "@/components/watchlist-manager";
import { BreakoutManager } from "@/components/breakout-manager";
import { PriceAlertManager } from "@/components/price-alert-manager";
import { SOURCES, type SourceId } from "@/lib/source-meta";
import { fetchSignals, fetchStats } from "@/lib/supabase";
import type { Signal, StatsBundle, TimeWindow } from "@/lib/types";

type Dir = "pump" | "dump" | "all";

interface PageSearchParams {
  direction?: string;
  window?: string;
  sources?: string;
  source?: string;
}

function parseDir(v: string | undefined): Dir {
  return v === "pump" || v === "dump" ? v : "all";
}

function parseWindow(v: string | undefined): TimeWindow {
  return v === "1h" || v === "6h" || v === "7d" ? v : "24h";
}

function parseSources(p: PageSearchParams): SourceId[] {
  const validIds = new Set<SourceId>(SOURCES.map((s) => s.id));
  if (p.sources) {
    return p.sources
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is SourceId => validIds.has(s as SourceId));
  }
  if (p.source && validIds.has(p.source as SourceId)) {
    return [p.source as SourceId];
  }
  return [];
}

function buildLiveQuery(
  direction: Dir,
  window: TimeWindow,
  sources: SourceId[],
): URLSearchParams {
  const params = new URLSearchParams();
  if (direction !== "all") params.set("direction", direction);
  params.set("window", window);
  if (sources.length > 0) params.set("sources", sources.join(","));
  return params;
}

interface HomePageProps {
  searchParams: Promise<PageSearchParams>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const direction = parseDir(params.direction);
  const window = parseWindow(params.window);
  const sources = parseSources(params);

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
        sources: sources.length > 0 ? sources : undefined,
      }),
      fetchStats(window),
    ]);
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <div className="min-h-screen">
      <header className="border-border bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6 md:py-4">
          <div className="flex items-center gap-2.5">
            <Zap className="text-primary h-5 w-5" />
            <span className="text-sm font-semibold tracking-tight md:text-base">
              OKX Pump Monitor
            </span>
            <span className="text-muted-foreground ml-2 hidden text-xs md:inline">
              Perpetual swap signals
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <WatchlistManager />
            <BreakoutManager />
            <PriceAlertManager />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-6">
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

        <div className="mt-6 flex flex-col gap-4 lg:flex-row">
          <FilterSidebar current={{ direction, window, sources }} />
          <div className="flex-1 min-w-0">
            <SignalsLive
              initialSignals={signals}
              queryString={buildLiveQuery(direction, window, sources).toString()}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
