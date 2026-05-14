import { FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { SOURCES } from "@/lib/source-meta";
import {
  fetchSignalsForBacktest,
  replayAll,
  aggregate,
  runWalkForward,
  type AggRow,
  type BacktestRow,
  type WalkForwardSummary,
  type WalkForwardWindow,
} from "@/lib/backtest";

export const metadata = {
  title: "Backtest · OKX Pump Monitor",
};

export const dynamic = "force-dynamic";

interface PageSearchParams {
  since?: string;
  source?: string;
  horizon?: string;
  limit?: string;
  mode?: string;        // "simple" | "walkforward"
  window_days?: string;  // walk-forward 用
}

function defaultSinceIso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();
}

type Mode = "simple" | "walkforward";

function parseParams(p: PageSearchParams): {
  since_iso: string;
  source: string;
  horizon: number;
  limit: number;
  display_since: string;
  mode: Mode;
  window_days: number;
} {
  // since: 'YYYY-MM-DD' or '7d' or full ISO
  let since_iso: string;
  let display_since: string;
  if (!p.since) {
    since_iso = defaultSinceIso(3);
    display_since = "3d";
  } else if (p.since.endsWith("d") && /^\d+d$/.test(p.since)) {
    const days = parseInt(p.since.slice(0, -1), 10);
    since_iso = defaultSinceIso(days);
    display_since = p.since;
  } else if (p.since.includes("T")) {
    since_iso = p.since;
    display_since = p.since.slice(0, 16);
  } else {
    since_iso = `${p.since}T00:00:00Z`;
    display_since = p.since;
  }
  const source = p.source || "all";
  const horizon = Math.max(5, Math.min(120, parseInt(p.horizon ?? "15", 10) || 15));
  const limit = Math.max(20, Math.min(500, parseInt(p.limit ?? "150", 10) || 150));
  const mode: Mode = p.mode === "walkforward" ? "walkforward" : "simple";
  const window_days = Math.max(2, Math.min(14, parseInt(p.window_days ?? "7", 10) || 7));
  return { since_iso, source, horizon, limit, display_since, mode, window_days };
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function toneClass(v: number): string {
  return v > 0 ? "text-emerald-300" : v < 0 ? "text-rose-300" : "text-muted-foreground";
}

interface BacktestPageProps {
  searchParams: Promise<PageSearchParams>;
}

export default async function BacktestPage({ searchParams }: BacktestPageProps) {
  const params = await searchParams;
  const opts = parseParams(params);

  let rows: BacktestRow[] = [];
  let totalFetched = 0;
  let errorMsg: string | null = null;
  try {
    const signals = await fetchSignalsForBacktest({
      since_iso: opts.since_iso,
      source: opts.source,
      limit: opts.limit,
    });
    totalFetched = signals.length;
    rows = await replayAll(signals, opts.horizon, 8);
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : "unknown error";
  }

  const bySource = aggregate(rows, (r) => r.source);
  const byConfidence = aggregate(rows, (r) => `★${r.confidence_score}`);

  // V2.16: walk-forward sweep (mode=walkforward 时计算，否则 null)
  let wf: WalkForwardSummary | null = null;
  if (opts.mode === "walkforward" && rows.length > 0) {
    wf = runWalkForward(rows, { window_days: opts.window_days });
  }

  const sourceOptions = ["all", ...SOURCES.map((s) => s.id)];
  const sinceOptions = ["1d", "3d", "7d", "14d", "30d"];
  const horizonOptions = [5, 15, 30, 60, 120];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="bg-accent/50 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
          <FlaskConical className="text-primary h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              Backtest Lab
            </h1>
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-300"
            >
              live · OKX history-candles
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            把过去 N 天的 supabase signals 重新跑一遍 · 测每个 monitor 的命中率 / 平均 horizon return · 改阈值前先回测
          </p>
        </div>
      </div>

      {/* Filter bar (URL-driven, server-rendered, no client JS needed) */}
      <form
        method="get"
        action="/backtest"
        className="bg-card border-border mb-6 grid grid-cols-2 gap-3 rounded-lg border p-4 md:grid-cols-7"
      >
        <FilterSelect
          name="mode"
          label="Mode"
          value={opts.mode}
          options={["simple", "walkforward"]}
        />
        <FilterSelect
          name="since"
          label="Window"
          value={opts.display_since}
          options={sinceOptions}
        />
        <FilterSelect
          name="source"
          label="Monitor"
          value={opts.source}
          options={sourceOptions}
        />
        <FilterSelect
          name="horizon"
          label="Horizon (min)"
          value={String(opts.horizon)}
          options={horizonOptions.map(String)}
        />
        <FilterSelect
          name="limit"
          label="Max signals"
          value={String(opts.limit)}
          options={["50", "100", "150", "300", "500"]}
        />
        <FilterSelect
          name="window_days"
          label="WF window (d)"
          value={String(opts.window_days)}
          options={["3", "5", "7", "10", "14"]}
        />
        <div className="flex items-end">
          <button
            type="submit"
            className="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-md px-3 py-2 text-sm font-medium"
          >
            ⚡ Run
          </button>
        </div>
      </form>

      {errorMsg ? (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          Backtest failed: {errorMsg}
        </div>
      ) : null}

      {/* KPI bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="Signals fetched" value={String(totalFetched)} />
        <KPI label="Replayed OK" value={String(rows.length)} />
        <KPI
          label="Skipped"
          value={String(totalFetched - rows.length)}
          tone={totalFetched - rows.length > 0 ? "dump" : undefined}
        />
        <KPI
          label="Avg signed return"
          value={
            rows.length === 0
              ? "—"
              : fmtPct(
                  rows.reduce((a, r) => a + r.signed_return_pct, 0) / rows.length,
                )
          }
          tone={
            rows.length > 0 &&
            rows.reduce((a, r) => a + r.signed_return_pct, 0) > 0
              ? "pump"
              : "dump"
          }
        />
      </div>

      {/* WALK-FORWARD (mode=walkforward only) */}
      {wf ? (
        <section className="mb-6">
          <h2 className="text-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
            🔁 Walk-forward sweep · {opts.window_days}d window, 70/30 train/test split
          </h2>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KPI
              label="OK windows"
              value={`${wf.ok_windows} / ${wf.windows.length}`}
            />
            <KPI
              label="Avg best threshold"
              value={`|chg| ≥ ${wf.avg_best_threshold.toFixed(1)}%`}
            />
            <KPI
              label="Threshold stability (σ)"
              value={`±${wf.threshold_std.toFixed(2)}`}
              tone={wf.threshold_std > 1 ? "dump" : undefined}
            />
            <KPI
              label="Avg OOS return"
              value={fmtPct(wf.avg_oos_return)}
              tone={wf.avg_oos_return > 0 ? "pump" : "dump"}
            />
          </div>

          <WalkForwardTable windows={wf.windows} />

          <div className="text-muted-foreground mt-3 text-xs leading-relaxed">
            <p className="mb-1">
              🧠 <strong>How to read</strong>：每个窗口前 70% 数据找最优阈值，后 30% 真实验证。
              阈值跨窗口稳定（σ 小）+ OOS 平均正回报 = 该 monitor 的真实可用阈值。
            </p>
            <p>
              ⚠️ <strong>避免</strong>：σ 大 = 阈值不稳定（数据少或市场结构变）；OOS 平均
              负回报 = 训练集 overfit，真实交易会亏。
            </p>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* BY SOURCE */}
        <section>
          <h2 className="text-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
            📊 By monitor source
          </h2>
          <AggTable rows={bySource} keyLabel="Source" />
        </section>

        {/* BY CONFIDENCE */}
        <section>
          <h2 className="text-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
            ⭐ By confidence (fusion stars)
          </h2>
          <AggTable rows={byConfidence} keyLabel="Confidence" />
        </section>
      </div>

      <div className="text-muted-foreground mt-8 text-xs">
        Reference: scanner/backtest/replay.py · 同等逻辑 port 到 TS·OKX history-candles 5min cache·
        Signed return = direction-adjusted（pump 后涨 = 正；dump 后跌 = 正）
      </div>
    </main>
  );
}

interface FilterSelectProps {
  name: string;
  label: string;
  value: string;
  options: ReadonlyArray<string>;
}

function FilterSelect({ name, label, value, options }: FilterSelectProps) {
  const hasValue = options.includes(value);
  return (
    <label className="block">
      <span className="text-muted-foreground text-[10px] uppercase tracking-wider">
        {label}
      </span>
      <select
        name={name}
        defaultValue={hasValue ? value : options[0]}
        className="bg-background border-border focus:border-primary mt-1 block w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

interface KPIProps {
  label: string;
  value: string;
  tone?: "pump" | "dump";
}

function KPI({ label, value, tone }: KPIProps) {
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

function WalkForwardTable({ windows }: { windows: WalkForwardWindow[] }) {
  if (windows.length === 0) {
    return (
      <div className="bg-card border-border flex items-center justify-center rounded-lg border p-10 text-center">
        <span className="text-muted-foreground text-sm">
          数据窗口不足 — 试着把 since 改大或选 source=all
        </span>
      </div>
    );
  }
  return (
    <div className="bg-card border-border overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-accent/30 border-border border-b">
          <tr className="text-muted-foreground text-[11px] uppercase">
            <th className="px-3 py-2 text-left">Window</th>
            <th className="px-3 py-2 text-right">Train n</th>
            <th className="px-3 py-2 text-right">Test n</th>
            <th className="px-3 py-2 text-right">Best thr</th>
            <th className="px-3 py-2 text-right">Train return</th>
            <th className="px-3 py-2 text-right">OOS test n</th>
            <th className="px-3 py-2 text-right">OOS return</th>
            <th className="px-3 py-2 text-right">OOS hit%</th>
            <th className="px-3 py-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {windows.map((w, i) => (
            <tr
              key={`${w.window_start}-${i}`}
              className="border-border/50 hover:bg-accent/20 border-b last:border-b-0"
            >
              <td className="text-muted-foreground px-3 py-2 font-mono text-[11px]">
                {w.window_start.slice(5, 10)} → {w.window_end.slice(5, 10)}
              </td>
              <td className="text-muted-foreground px-3 py-2 text-right font-mono text-xs">
                {w.n_train}
              </td>
              <td className="text-muted-foreground px-3 py-2 text-right font-mono text-xs">
                {w.n_test}
              </td>
              <td className="text-foreground px-3 py-2 text-right font-mono text-xs font-semibold">
                {w.status === "insufficient_train" ? "—" : `${w.best_threshold.toFixed(1)}`}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono text-xs ${
                  w.status === "insufficient_train"
                    ? "text-muted-foreground"
                    : toneClass(w.train_avg_signed)
                }`}
              >
                {w.status === "insufficient_train" ? "—" : fmtPct(w.train_avg_signed)}
              </td>
              <td className="text-muted-foreground px-3 py-2 text-right font-mono text-xs">
                {w.test_n_filtered || "—"}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono text-xs font-semibold ${
                  w.test_avg_signed === null
                    ? "text-muted-foreground"
                    : toneClass(w.test_avg_signed)
                }`}
              >
                {w.test_avg_signed === null ? "—" : fmtPct(w.test_avg_signed)}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono text-xs ${
                  w.test_hit_pct === null
                    ? "text-muted-foreground"
                    : w.test_hit_pct >= 50
                    ? "text-emerald-300"
                    : "text-rose-300"
                }`}
              >
                {w.test_hit_pct === null ? "—" : `${w.test_hit_pct.toFixed(0)}%`}
              </td>
              <td className="px-3 py-2 text-center">
                {w.status === "ok" ? (
                  <span className="bg-emerald-500/15 text-emerald-300 rounded px-1.5 py-0.5 text-[10px]">
                    OK
                  </span>
                ) : w.status === "insufficient_train" ? (
                  <span className="bg-zinc-500/15 text-zinc-400 rounded px-1.5 py-0.5 text-[10px]">
                    skip train
                  </span>
                ) : (
                  <span className="bg-amber-500/15 text-amber-300 rounded px-1.5 py-0.5 text-[10px]">
                    skip test
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AggTable({ rows, keyLabel }: { rows: AggRow[]; keyLabel: string }) {
  if (rows.length === 0) {
    return (
      <div className="bg-card border-border flex items-center justify-center rounded-lg border p-10 text-center">
        <span className="text-muted-foreground text-sm">无可回测的信号</span>
      </div>
    );
  }
  return (
    <div className="bg-card border-border overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-accent/30 border-border border-b">
          <tr className="text-muted-foreground text-[11px] uppercase">
            <th className="px-3 py-2 text-left">{keyLabel}</th>
            <th className="px-3 py-2 text-right">n</th>
            <th className="px-3 py-2 text-right">Hit%</th>
            <th className="px-3 py-2 text-right">Avg</th>
            <th className="px-3 py-2 text-right">Median</th>
            <th className="px-3 py-2 text-right">Best</th>
            <th className="px-3 py-2 text-right">Worst</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className="border-border/50 hover:bg-accent/20 border-b last:border-b-0"
            >
              <td className="text-foreground px-3 py-2 font-mono text-xs font-semibold">
                {r.key}
              </td>
              <td className="text-muted-foreground px-3 py-2 text-right font-mono text-xs">
                {r.n}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono text-xs font-semibold ${
                  r.hit_pct >= 50 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {r.hit_pct.toFixed(1)}%
              </td>
              <td
                className={`px-3 py-2 text-right font-mono text-xs font-semibold ${toneClass(r.avg_signed)}`}
              >
                {fmtPct(r.avg_signed)}
              </td>
              <td className={`px-3 py-2 text-right font-mono text-xs ${toneClass(r.median_signed)}`}>
                {fmtPct(r.median_signed)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-[11px] text-emerald-300/80">
                {fmtPct(r.best_signed)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-[11px] text-rose-300/80">
                {fmtPct(r.worst_signed)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
