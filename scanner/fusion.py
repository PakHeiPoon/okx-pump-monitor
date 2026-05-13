"""Signal fusion — 多 monitor 同币种共振检测（V2.9 / Phase 3）。

底层逻辑：同一币种在同一轮扫描里被多个 monitor 同时命中，比单一维度信号
强得多。融合层不丢弃任何 raw signal（backtest 要用），而是给每个信号打
上 fusion 元数据：

  meta.confidence_score: 1-5（同 inst_id 命中的不同 source 数，capped）
  meta.fused_sources:    list[str]（同组所有 source 名）
  meta.fusion_primary:   bool（同组里 |chg_pct| 最大的标记为 primary）
  meta.fusion_group_id:  str（inst_id|time_bucket，便于 dashboard JOIN）

下游：
- FeishuNotifier 渲染时按 primary 折叠展示，related 信号变成"+N 维度"chip
- Dashboard 用 fusion_group_id 服务端 group，SignalCard.related[] 自动填
- Supabase 仍保留每行 raw signal（meta 里带 fusion 标记），backtest 不受影响
"""
from collections import defaultdict


def fuse(signals, time_bucket_min: int = 5):
    """对一组 fresh_signals 做就地融合标记（不改变 list 长度，只丰富 meta）。

    time_bucket_min: 同 inst_id 信号在多少分钟内算同一融合组。默认 5min。
    Scanner 单轮扫描通常 1-3 分钟跑完，所以 5min 足够把同轮所有同币信号归一组。
    """
    if not signals:
        return signals

    # 按 inst_id + time bucket 分组
    groups = defaultdict(list)
    for s in signals:
        bucket = (s.bar_ts_ms // 1000 // 60 // time_bucket_min) if s.bar_ts_ms else 0
        groups[(s.inst_id, bucket)].append(s)

    for (inst_id, bucket), group in groups.items():
        distinct_sources = list({s.source for s in group})
        confidence = min(5, len(distinct_sources))
        # primary = |chg_pct| 最大的（最显著的那条作为代表）
        primary = max(group, key=lambda s: abs(s.chg_pct))
        group_id = f"{inst_id}|{bucket * time_bucket_min}"

        for s in group:
            # 不覆盖现有 meta 字段，只增量加 fusion 标记
            if not isinstance(s.meta, dict):
                s.meta = {}
            s.meta["confidence_score"] = confidence
            s.meta["fused_sources"] = distinct_sources
            s.meta["fusion_primary"] = (s is primary)
            s.meta["fusion_group_id"] = group_id

    return signals


def primary_signals(signals):
    """从已 fuse 的 signals 列表里抽出 primary（每组一条）。Feishu 推送时用。"""
    return [s for s in signals if s.meta.get("fusion_primary", True)]
