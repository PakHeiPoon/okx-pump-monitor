import Link from "next/link";
import { HeartPulse, Activity, AlertTriangle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { fetchRecentHeartbeats, type Heartbeat } from "@/lib/heartbeat";

export const metadata = {
  title: "Health · OKX Pump Monitor",
};

export const dynamic = "force-dynamic";

type Status = "ok" | "degraded" | "down" | "unknown";

interface KindBucket {
  kind: string;        // 'main' / 'realtime' / unknown
  latest: Heartbeat | null;
  rows: Heartbeat[];
}

function kindOf(hb: Heartbeat): string {
  const k = (hb.meta as { kind?: string } | undefined)?.kind;
  return typeof k === "string" ? k : "main";
}

function bucketize(rows: Heartbeat[]): KindBucket[] {
  const by: Map<string, Heartbeat[]> = new Map();
  for (const r of rows) {
    const k = kindOf(r);
    const arr = by.get(k) ?? [];
    arr.push(r);
    by.set(k, arr);
  }
  // 排序：main first，其次按 kind 字母
  const buckets = Array.from(by.entries()).map(([kind, list]) => ({
    kind,
    latest: list[0] ?? null,
    rows: list,
  }));
  buckets.sort((a, b) => (a.kind === "main" ? -1 : b.kind === "main" ? 1 : a.kind.localeCompare(b.kind)));
  return buckets;
}

function statusOf(hb: Heartbeat | null, kind: string): {
  status: Status;
  age_min: number | null;
} {
  if (!hb) return { status: "unknown", age_min: null };
  const ageMs = Date.now() - new Date(hb.started_at).getTime();
  const ageMin = ageMs / 60_000;
  // main 跑 15min cron，realtime 跑 5min cron — 阈值不同
  const isRealtime = kind === "realtime";
  const degradedThreshold = isRealtime ? 10 : 20;
  const downThreshold = isRealtime ? 15 : 30;
  if (ageMin >= downThreshold) return { status: "down", age_min: ageMin };
  if (ageMin >= degradedThreshold) return { status: "degraded", age_min: ageMin };
  return { status: "ok", age_min: ageMin };
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

function statusColor(s: Status): string {
  return s === "ok"
    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
    : s === "degraded"
    ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
    : s === "down"
    ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
    : "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
}

function statusLabel(s: Status): string {
  return s === "ok"
    ? "OPERATIONAL"
    : s === "degraded"
    ? "DEGRADED"
    : s === "down"
    ? "DOWN"
    : "UNKNOWN";
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === "degraded") return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  if (status === "down") return <AlertTriangle className="h-4 w-4 text-rose-400" />;
  return <Activity className="h-4 w-4 text-zinc-400" />;
}

const KIND_LABEL: Record<string, { emoji: string; title: string; subtitle: string }> = {
  main: {
    emoji: "⏰",
    title: "Main scanner",
    subtitle: "scan.yml · 15min cron · 14 monitors",
  },
  realtime: {
    emoji: "⚡",
    title: "Realtime scanner",
    subtitle: "scan-realtime.yml · 5min cron · flush_reversal only",
  },
};

export default async function HealthPage() {
  let heartbeats: Heartbeat[] = [];
  let errorMsg: string | null = null;
  try {
    heartbeats = await fetchRecentHeartbeats(30);
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : "unknown error";
  }

  const buckets = bucketize(heartbeats);
  const worstStatus: Status = buckets.length === 0
    ? "unknown"
    : buckets
        .map((b) => statusOf(b.latest, b.kind).status)
        .reduce<Status>((acc, s) => {
          if (acc === "down" || s === "down") return "down";
          if (acc === "degraded" || s === "degraded") return "degraded";
          if (acc === "unknown" || s === "unknown") return "unknown";
          return "ok";
        }, "ok");

  // 全局 KPI（最近 30 次跑的综合数据）
  const totalSignals = heartbeats.reduce((acc, h) => acc + h.signals_found, 0);
  const totalFresh = heartbeats.reduce((acc, h) => acc + h.fresh_signals, 0);
  const totalErrors = heartbeats.reduce((acc, h) => acc + h.okx_errors, 0);
  const avgDuration =
    heartbeats.length === 0
      ? 0
      : heartbeats.reduce((acc, h) => acc + h.duration_ms, 0) / heartbeats.length;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="bg-accent/50 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
          <HeartPulse className="text-primary h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              System Health
            </h1>
            <Badge variant="outline" className={statusColor(worstStatus)}>
              <StatusIcon status={worstStatus} />
              <span className="ml-1">{statusLabel(worstStatus)}</span>
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            scanner_heartbeat 表 · 阈值：main 30min DOWN / realtime 15min DOWN ·{" "}
            <Link
              href="https://github.com/PakHeiPoon/okx-pump-monitor/actions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              GH Actions logs →
            </Link>
          </p>
        </div>
      </div>

      {errorMsg ? (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          Failed to load heartbeats: {errorMsg}
        </div>
      ) : null}

      {/* KPI 全局 */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="最近 30 次心跳" value={String(heartbeats.length)} />
        <KPI label="累计信号检出" value={String(totalSignals)} />
        <KPI label="累计推送" value={String(totalFresh)} />
        <KPI
          label="累计错误"
          value={String(totalErrors)}
          tone={totalErrors > 0 ? "dump" : undefined}
        />
      </div>

      <div className="mb-6 text-muted-foreground text-xs">
        平均运行时长 {(avgDuration / 1000).toFixed(1)}s
      </div>

      {/* 每个 scanner kind 一栏 */}
      <div className="space-y-6">
        {buckets.length === 0 ? (
          <EmptyBlock text="scanner_heartbeat 表为空 — 等待第一个 scan.yml 运行后填充" />
        ) : (
          buckets.map((b) => {
            const meta = KIND_LABEL[b.kind] ?? {
              emoji: "•",
              title: b.kind,
              subtitle: "",
            };
            const status = statusOf(b.latest, b.kind);
            return (
              <section key={b.kind}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-foreground text-sm font-semibold uppercase tracking-wider">
                      {meta.emoji} {meta.title}
                    </h2>
                    <div className="text-muted-foreground text-[11px]">
                      {meta.subtitle}
                    </div>
                  </div>
                  <Badge variant="outline" className={statusColor(status.status)}>
                    <StatusIcon status={status.status} />
                    <span className="ml-1 font-mono text-[11px]">
                      {statusLabel(status.status)}
                      {status.age_min !== null
                        ? ` · ${status.age_min.toFixed(1)}min ago`
                        : ""}
                    </span>
                  </Badge>
                </div>

                <div className="bg-card border-border overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-accent/30 border-border border-b">
                      <tr className="text-muted-foreground text-[11px] uppercase">
                        <th className="px-3 py-2 text-left">Started</th>
                        <th className="px-3 py-2 text-right">Duration</th>
                        <th className="px-3 py-2 text-right">Monitors</th>
                        <th className="px-3 py-2 text-right">Signals</th>
                        <th className="px-3 py-2 text-right">Fresh</th>
                        <th className="px-3 py-2 text-right">Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.rows.slice(0, 15).map((h) => (
                        <tr
                          key={h.id}
                          className="border-border/50 hover:bg-accent/20 border-b last:border-b-0"
                        >
                          <td className="text-muted-foreground px-3 py-2 font-mono text-[11px]">
                            {timeAgo(h.started_at)} ago
                          </td>
                          <td className="text-muted-foreground px-3 py-2 text-right font-mono text-[11px]">
                            {(h.duration_ms / 1000).toFixed(1)}s
                          </td>
                          <td className="text-muted-foreground px-3 py-2 text-right font-mono text-[11px]">
                            {h.monitors_run}
                          </td>
                          <td className="text-foreground px-3 py-2 text-right font-mono text-xs font-semibold">
                            {h.signals_found}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono text-xs ${
                              h.fresh_signals > 0
                                ? "font-semibold text-emerald-300"
                                : "text-muted-foreground"
                            }`}
                          >
                            {h.fresh_signals}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono text-xs ${
                              h.okx_errors > 0
                                ? "font-semibold text-rose-300"
                                : "text-muted-foreground"
                            }`}
                          >
                            {h.okx_errors}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        )}
      </div>

      <div className="text-muted-foreground mt-8 text-xs">
        Data: supabase `scanner_heartbeat` · 自动每 10s revalidate · watchdog 在 Vercel
        cron route /api/cron/watchdog 监这张表 → 超时发飞书告警
      </div>
    </main>
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
