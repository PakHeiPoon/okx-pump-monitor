import Link from "next/link";

import type { TimeWindow } from "@/lib/types";

type Dir = "pump" | "dump" | "all";

interface FilterSidebarProps {
  current: {
    direction: Dir;
    window: TimeWindow;
    source: string;
  };
}

interface QueryUpdate {
  direction?: Dir;
  window?: TimeWindow;
  source?: string;
}

function buildHref(current: FilterSidebarProps["current"], update: QueryUpdate): string {
  const params = new URLSearchParams();
  const dir = update.direction ?? current.direction;
  const win = update.window ?? current.window;
  const src = update.source ?? current.source;
  if (dir && dir !== "all") params.set("direction", dir);
  if (win && win !== "24h") params.set("window", win);
  if (src && src !== "all") params.set("source", src);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

function RowGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wider">
        {title}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

export function FilterSidebar({ current }: FilterSidebarProps) {
  return (
    <aside className="bg-card border-border flex w-56 shrink-0 flex-col gap-5 rounded-lg border p-4">
      <RowGroup title="Direction">
        <FilterLink
          href={buildHref(current, { direction: "all" })}
          active={current.direction === "all"}
        >
          All
        </FilterLink>
        <FilterLink
          href={buildHref(current, { direction: "pump" })}
          active={current.direction === "pump"}
        >
          🚀 Pump
        </FilterLink>
        <FilterLink
          href={buildHref(current, { direction: "dump" })}
          active={current.direction === "dump"}
        >
          📉 Dump
        </FilterLink>
      </RowGroup>

      <RowGroup title="Source">
        <FilterLink
          href={buildHref(current, { source: "all" })}
          active={current.source === "all"}
        >
          All sources
        </FilterLink>
        <FilterLink
          href={buildHref(current, { source: "swap_top_gainers" })}
          active={current.source === "swap_top_gainers"}
        >
          TOP50 gainers
        </FilterLink>
        <FilterLink
          href={buildHref(current, { source: "watchlist" })}
          active={current.source === "watchlist"}
        >
          Watchlist
        </FilterLink>
      </RowGroup>

      <RowGroup title="Time window">
        {(["1h", "6h", "24h", "7d"] as TimeWindow[]).map((w) => (
          <FilterLink
            key={w}
            href={buildHref(current, { window: w })}
            active={current.window === w}
          >
            {w}
          </FilterLink>
        ))}
      </RowGroup>
    </aside>
  );
}
