/**
 * Signal fusion helpers — match scanner/fusion.py output.
 *
 * Scanner writes `meta.fusion_group_id` / `meta.fusion_primary` /
 * `meta.confidence_score` / `meta.fused_sources` on each signal row.
 * 这里只是按 fusion_group_id 重组成 SignalCard 友好的 (primary, related[])。
 *
 * 老数据（V2.9 之前）没有 fusion_group_id —— 自动回退为单信号即组。
 */
import type { Signal } from "@/lib/types";

export interface FusionGroup {
  primary: Signal;
  related: Signal[];          // 同组其它非 primary 信号
  confidence: number;         // 1-5
  fused_sources: string[];    // 同组所有不同 source 名
}

function groupKey(s: Signal): string {
  const gid = s.meta?.fusion_group_id;
  if (typeof gid === "string" && gid.length > 0) return gid;
  // 回退：用 inst_id + detected_at 分钟桶（5min）保证老数据也能分组
  const t = new Date(s.detected_at).getTime();
  const bucket = Math.floor(t / 60_000 / 5);
  return `${s.inst_id}|${bucket * 5}`;
}

export function fuseSignals(signals: Signal[]): FusionGroup[] {
  const buckets = new Map<string, Signal[]>();
  for (const s of signals) {
    const k = groupKey(s);
    const arr = buckets.get(k) ?? [];
    arr.push(s);
    buckets.set(k, arr);
  }

  const groups: FusionGroup[] = [];
  for (const arr of buckets.values()) {
    // primary = 标记位有就用，否则取 |chg_pct| 最大
    const primary =
      arr.find((s) => s.meta?.fusion_primary === true) ??
      arr.slice().sort((a, b) => Math.abs(Number(b.chg_pct)) - Math.abs(Number(a.chg_pct)))[0];
    const related = arr.filter((s) => s.id !== primary.id);
    const distinctSources = new Set(arr.map((s) => s.source));
    const confidence =
      (primary.meta?.confidence_score as number | undefined) ??
      Math.min(5, distinctSources.size);
    const fusedSources =
      (primary.meta?.fused_sources as string[] | undefined) ?? Array.from(distinctSources);
    groups.push({
      primary,
      related,
      confidence,
      fused_sources: fusedSources,
    });
  }

  // 排序：confidence 高优先，其次 primary.detected_at 新优先
  groups.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (
      new Date(b.primary.detected_at).getTime() -
      new Date(a.primary.detected_at).getTime()
    );
  });
  return groups;
}
