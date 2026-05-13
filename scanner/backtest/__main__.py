"""CLI entry: `python -m scanner.backtest`.

Examples:
    python -m scanner.backtest --since 2026-05-01
    python -m scanner.backtest --since 2026-05-10 --monitor swap_top_gainers --horizon-min 30
    python -m scanner.backtest --since 2026-05-12 --csv /tmp/bt.csv

输出表（按 source 聚合 + 按 confidence 聚合）：
    source          n     hit_rate    avg_return   median_return
    swap_top_g...   42    0.62        +1.18%       +0.45%
    oi_surge        15    0.40        +0.32%       -0.10%
    ...
"""
import argparse
import csv
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone

from .replay import fetch_signals_since, replay_all, to_dict


def main():
    ap = argparse.ArgumentParser(description="Replay Supabase signals against OKX history.")
    ap.add_argument("--since", required=True, help="ISO date, e.g. 2026-05-01")
    ap.add_argument("--monitor", default="all", help="source name or 'all' (default)")
    ap.add_argument("--horizon-min", type=int, default=15, help="forward window in minutes (default 15)")
    ap.add_argument("--csv", default=None, help="optional CSV output path")
    ap.add_argument("--limit", type=int, default=5000, help="max signals to pull (default 5000)")
    args = ap.parse_args()

    # 标准化 since 到 ISO+Z
    if "T" not in args.since:
        since_iso = args.since + "T00:00:00Z"
    else:
        since_iso = args.since

    print(f"[backtest] fetching signals since {since_iso} (source={args.monitor}, limit={args.limit})...")
    signals = fetch_signals_since(since_iso, source=args.monitor, limit=args.limit)
    print(f"[backtest] got {len(signals)} signals, replaying horizon={args.horizon_min}min...")

    rows = replay_all(signals, horizon_min=args.horizon_min)
    print(f"[backtest] {len(rows)} replays succeeded (skipped {len(signals) - len(rows)} with insufficient K-line data)")

    if not rows:
        print("nothing to summarize")
        sys.exit(0)

    # 汇总 by source
    by_src = defaultdict(list)
    for r in rows:
        by_src[r.source].append(r)

    print()
    print(f"{'source':<22s} {'n':>5s}  {'hit%':>6s}  {'avg_ret':>9s}  {'med_ret':>9s}  {'best':>8s}  {'worst':>8s}")
    print("-" * 80)
    for src in sorted(by_src):
        rs = by_src[src]
        n = len(rs)
        hit = sum(1 for r in rs if r.is_correct) / n * 100
        # 对 dump signal，"正确"=后表现负，所以需要按 direction 调整后再求 avg
        signed_returns = [
            r.horizon_return_pct if r.direction in ("pump", "above")
            else -r.horizon_return_pct
            for r in rs
        ]
        avg = statistics.mean(signed_returns)
        med = statistics.median(signed_returns)
        best = max(signed_returns)
        worst = min(signed_returns)
        print(f"{src:<22s} {n:>5d}  {hit:>5.1f}%  {avg:>+8.2f}%  {med:>+8.2f}%  {best:>+7.2f}%  {worst:>+7.2f}%")

    # 汇总 by confidence
    by_conf = defaultdict(list)
    for r in rows:
        by_conf[r.confidence_score].append(r)
    print()
    print(f"{'confidence':<22s} {'n':>5s}  {'hit%':>6s}  {'avg_ret':>9s}  {'med_ret':>9s}")
    print("-" * 80)
    for c in sorted(by_conf):
        rs = by_conf[c]
        n = len(rs)
        hit = sum(1 for r in rs if r.is_correct) / n * 100
        signed_returns = [
            r.horizon_return_pct if r.direction in ("pump", "above")
            else -r.horizon_return_pct
            for r in rs
        ]
        avg = statistics.mean(signed_returns)
        med = statistics.median(signed_returns)
        label = f"★{'★' * (c - 1)}{'☆' * (5 - c)}"
        print(f"{label:<22s} {n:>5d}  {hit:>5.1f}%  {avg:>+8.2f}%  {med:>+8.2f}%")

    # 可选 CSV 导出
    if args.csv:
        cols = list(to_dict(rows[0]).keys())
        with open(args.csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for r in rows:
                d = to_dict(r)
                d["fused_sources"] = "|".join(d.get("fused_sources") or [])
                w.writerow(d)
        print(f"\n[backtest] CSV → {args.csv}")


if __name__ == "__main__":
    main()
