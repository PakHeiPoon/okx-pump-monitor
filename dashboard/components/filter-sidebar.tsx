"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SOURCES, type SourceId } from "@/lib/source-meta";
import type { TimeWindow } from "@/lib/types";

type Dir = "pump" | "dump" | "all";

interface FilterSidebarProps {
  current: {
    direction: Dir;
    window: TimeWindow;
    sources: SourceId[];   // empty = all
  };
}

interface QueryUpdate {
  direction?: Dir;
  window?: TimeWindow;
  sources?: SourceId[];
}

function buildQs(
  current: FilterSidebarProps["current"],
  update: QueryUpdate,
): string {
  const params = new URLSearchParams();
  const dir = update.direction ?? current.direction;
  const win = update.window ?? current.window;
  const srcs = update.sources ?? current.sources;
  if (dir && dir !== "all") params.set("direction", dir);
  if (win && win !== "24h") params.set("window", win);
  if (srcs.length > 0) params.set("sources", srcs.join(","));
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

function RowGroup({
  title,
  children,
  extra,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider">
        <span>{title}</span>
        {extra ?? null}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

export function FilterSidebar({ current }: FilterSidebarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function navigate(update: QueryUpdate): void {
    const href = buildQs(current, update);
    startTransition(() => {
      router.push(href);
    });
  }

  function toggleSource(src: SourceId): void {
    const set = new Set(current.sources);
    if (set.has(src)) set.delete(src);
    else set.add(src);
    navigate({ sources: Array.from(set) });
  }

  function setAllSources(allOn: boolean): void {
    navigate({ sources: allOn ? SOURCES.map((s) => s.id) : [] });
  }

  return (
    <aside
      className={`bg-card border-border flex w-60 shrink-0 flex-col gap-5 rounded-lg border p-4 transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <RowGroup title="Direction">
        {(["all", "pump", "dump"] as Dir[]).map((d) => (
          <button
            key={d}
            onClick={() => navigate({ direction: d })}
            className={`text-left rounded-md px-2.5 py-1.5 text-sm transition-colors ${
              current.direction === d
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            {d === "all" ? "All" : d === "pump" ? "🚀 Pump" : "📉 Dump"}
          </button>
        ))}
      </RowGroup>

      <RowGroup
        title="Source"
        extra={
          <div className="flex gap-2 text-[10px] normal-case font-normal">
            <button
              onClick={() => setAllSources(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              all
            </button>
            <span className="text-muted-foreground">/</span>
            <button
              onClick={() => setAllSources(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              none
            </button>
          </div>
        }
      >
        {SOURCES.map((s) => {
          const checked = current.sources.includes(s.id);
          return (
            <Label
              key={s.id}
              htmlFor={`src-${s.id}`}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/40"
            >
              <Checkbox
                id={`src-${s.id}`}
                checked={checked}
                onCheckedChange={() => toggleSource(s.id)}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-foreground">
                  {s.emoji} {s.shortLabel}
                </span>
                <span className="text-muted-foreground text-[11px]">
                  {s.label.split("·")[1]?.trim() ?? s.label}
                </span>
              </span>
            </Label>
          );
        })}
      </RowGroup>

      <RowGroup title="Time window">
        <div className="flex flex-wrap gap-1.5">
          {(["1h", "6h", "24h", "7d"] as TimeWindow[]).map((w) => (
            <button
              key={w}
              onClick={() => navigate({ window: w })}
              className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
                current.window === w
                  ? "bg-primary text-primary-foreground"
                  : "bg-accent/30 text-muted-foreground hover:bg-accent/60"
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </RowGroup>
    </aside>
  );
}
