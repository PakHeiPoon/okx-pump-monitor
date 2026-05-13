"""Realtime scanner — 高频 monitor 专用入口（5min cron）。

只跑对延迟敏感的 monitor：当前是 FlushReversalMonitor（闪崩 V 反弹），
反弹窗口 10-60min，5min 检测延迟足够抓到反弹早段。

为什么不放进 scanner.main：
- main 跑 11 个 monitor，单次 2-3 分钟，吃 60+ OKX API 调用
- 用户希望大部分维度的"事后整理性"信号保持 15min 粒度（省 API、降噪）
- 只有 flush_reversal 这种"窗口短 + 操作机会强"的形态需要高频

隔离设计：
- 独立 state-realtime.json，不和 main 的 state.json 抢 git push
- 独立 heartbeat 行（meta.kind='realtime'）方便后续 watchdog 区分
- 共享 Supabase signals 表 + Feishu webhook（告警体感一致）

CLI: `python -m scanner.realtime`
"""
import time
from datetime import datetime, timezone, timedelta

from .config import load
from . import state as state_mod
from . import fusion as fusion_mod
from .monitors.flush_reversal import FlushReversalMonitor
from .notifiers.feishu import FeishuNotifier
from .storage.supabase_client import SupabaseClient

CST = timezone(timedelta(hours=8))
STATE_FILE = "state-realtime.json"


def main():
    config = load()
    started_at_dt = datetime.now(timezone.utc)
    started_at_ts = time.time()
    now_str = datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] realtime scanner start — flush_reversal only")

    supabase = SupabaseClient(config.supabase_url, config.supabase_service_key)
    state = state_mod.prune_expired(
        state_mod.load(STATE_FILE), config.cooldown_min
    )

    all_signals = []
    fresh_signals = []
    okx_errors = 0
    monitors_run = 0

    try:
        monitors = [
            FlushReversalMonitor(config),
        ]
        monitors_run = len(monitors)
        for m in monitors:
            try:
                sigs = m.scan()
                print(f"  [{m.name}] hits={len(sigs)}")
                all_signals.extend(sigs)
            except Exception as e:
                okx_errors += 1
                print(f"  [{m.name}] FAILED: {e}")

        # 冷却去重
        now_ts = time.time()
        for s in all_signals:
            key = state_mod.make_cooldown_key(s)
            if key in state:
                continue
            fresh_signals.append(s)
            state[key] = now_ts

        if not fresh_signals:
            print("本轮无新闪崩反弹信号")
        else:
            fresh_signals = fusion_mod.fuse(fresh_signals, time_bucket_min=5)
            for s in fresh_signals:
                print(f"  ✓ {s.inst_id} V-bottom +{s.chg_pct}% (drop {s.meta.get('drop_pct')}%)")

            # 通知 + 持久化
            FeishuNotifier(config.feishu_webhook).send(fresh_signals)
            supabase.insert_signals(fresh_signals)
    finally:
        duration_ms = int((time.time() - started_at_ts) * 1000)
        try:
            supabase.insert_heartbeat({
                "started_at":    started_at_dt.isoformat(),
                "duration_ms":   duration_ms,
                "monitors_run":  monitors_run,
                "signals_found": len(all_signals),
                "fresh_signals": len(fresh_signals),
                "okx_errors":    okx_errors,
                "meta": {"kind": "realtime"},
            })
        except Exception as e:
            print(f"[heartbeat] insert FAILED: {e}")

        state_mod.save(state, STATE_FILE)


if __name__ == "__main__":
    main()
