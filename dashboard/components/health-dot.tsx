"use client";

import Link from "next/link";

// Phase 1 placeholder: hardcoded "ok" status.
// Watchdog backend (Tier 1, item #1) will replace this with a real status
// fetched from supabase `scanner_heartbeat` table.
type HealthStatus = "ok" | "degraded" | "down" | "unknown";

const STATUS_META: Record<HealthStatus, { label: string; color: string; pulse: boolean }> = {
  ok: { label: "All systems operational", color: "bg-emerald-500", pulse: true },
  degraded: { label: "Partial degradation", color: "bg-amber-500", pulse: true },
  down: { label: "Scanner offline", color: "bg-rose-500", pulse: false },
  unknown: { label: "Status unknown", color: "bg-zinc-500", pulse: false },
};

export function HealthDot() {
  // TODO: replace with real fetch once `/api/health` is wired.
  const status: HealthStatus = "ok";
  const meta = STATUS_META[status];

  return (
    <Link
      href="/health"
      title={meta.label}
      className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
    >
      <span className="relative inline-flex h-2 w-2">
        {meta.pulse ? (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 ${meta.color}`}
          />
        ) : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.color}`} />
      </span>
      <span className="hidden md:inline">System</span>
    </Link>
  );
}
