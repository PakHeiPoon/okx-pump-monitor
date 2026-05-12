"""Scanner 编排入口。GitHub Actions 调 `python -m scanner.main`。

执行流程：
1. 加载配置
2. 跑所有 enabled monitors → 汇总 signals
3. 过滤冷却期内已推送的 inst_id
4. 实时通知（飞书）
5. 持久化（Supabase signals 表）
6. 更新冷却 state.json
"""
import time
from datetime import datetime, timezone, timedelta

from .config import load
from . import state as state_mod
from .monitors.swap_top_gainers import SwapTopGainersMonitor
from .monitors.watchlist import WatchlistMonitor
from .monitors.volume_surge import VolumeSurgeMonitor
from .monitors.funding_extreme import FundingExtremeMonitor
from .monitors.breakout import BreakoutMonitor
from .monitors.price_alert import PriceAlertMonitor
from .monitors.oi_surge import OISurgeMonitor
from .notifiers.feishu import FeishuNotifier
from .storage.supabase_client import SupabaseClient

CST = timezone(timedelta(hours=8))


def main():
    config = load()
    now_str = datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] scanner start — pump≥{config.pump_threshold}% / dump≤-{config.dump_threshold}%")

    # 0. 持久层先建好（watchlist monitor 要用）
    supabase = SupabaseClient(config.supabase_url, config.supabase_service_key)

    # 1. 跑 monitors
    monitors = [
        SwapTopGainersMonitor(config),
        WatchlistMonitor(config, supabase),
        VolumeSurgeMonitor(config),
        FundingExtremeMonitor(config),
        BreakoutMonitor(config, supabase),
        PriceAlertMonitor(config, supabase),
        OISurgeMonitor(config, supabase),
    ]
    all_signals = []
    for m in monitors:
        sigs = m.scan()
        print(f"  [{m.name}] hits={len(sigs)}")
        all_signals.extend(sigs)

    # 2. 冷却去重
    state = state_mod.prune_expired(state_mod.load(), config.cooldown_min)
    now_ts = time.time()
    fresh_signals = []
    for s in all_signals:
        if s.inst_id in state:
            continue
        fresh_signals.append(s)
        state[s.inst_id] = now_ts

    if not fresh_signals:
        print("本轮无新信号（可能在冷却期）")
        state_mod.save(state)
        return

    # 3. 排序：先 pump 后 dump，绝对涨跌幅降序
    fresh_signals.sort(key=lambda s: (s.direction != "pump", -abs(s.chg_pct)))
    for s in fresh_signals:
        arrow = "+" if s.chg_pct >= 0 else ""
        print(f"  ✓ {s.inst_id} [{s.direction}] {arrow}{s.chg_pct}% vol={s.vol_usdt:.0f}U")

    # 4. 实时通知（飞书）
    notifiers = [
        FeishuNotifier(config.feishu_webhook),
        # V2: EmailDailyDigestNotifier 不在此处实时调用
    ]
    for n in notifiers:
        n.send(fresh_signals)

    # 5. 持久化（Supabase）
    supabase = SupabaseClient(config.supabase_url, config.supabase_service_key)
    supabase.insert_signals(fresh_signals)

    # 6. cooldown state
    state_mod.save(state)


if __name__ == "__main__":
    main()
