"""Scanner 编排入口。GitHub Actions 调 `python -m scanner.main`。

执行流程：
1. 加载配置
2. 跑所有 enabled monitors → 汇总 signals
3. 过滤冷却期内已推送的 (inst_id, direction, source) 三元组
4. 实时通知（飞书）
5. 持久化（Supabase signals 表）
6. 写 scanner_heartbeat（watchdog 用）
7. 更新冷却 state.json
"""
import time
from datetime import datetime, timezone, timedelta

from .config import load
from . import state as state_mod
from . import fusion as fusion_mod
from .monitors.swap_top_gainers import SwapTopGainersMonitor
from .monitors.watchlist import WatchlistMonitor
from .monitors.volume_surge import VolumeSurgeMonitor
from .monitors.funding_extreme import FundingExtremeMonitor
from .monitors.breakout import BreakoutMonitor
from .monitors.price_alert import PriceAlertMonitor
from .monitors.oi_surge import OISurgeMonitor
from .monitors.perp_premium import PerpPremiumMonitor
from .monitors.new_listings import NewListingsMonitor
from .monitors.longshort_ratio import LongShortRatioMonitor
from .monitors.liquidations import LiquidationsMonitor
# V2.15: cross_exchange 关闭——不匹配当前交易风格。文件保留，重启 2 行即可。
# from .monitors.cross_exchange import CrossExchangeMonitor
from .monitors.social_surge import SocialSurgeMonitor
from .monitors.whale_to_cex import WhaleToCexMonitor
# flush_reversal 不在这里——它走 scanner.realtime（独立 5min cron），需要更
# 低的检测延迟。在这里同时跑会造成重复 API 调用 + 重复告警。
from .notifiers.feishu import FeishuNotifier
from .storage.supabase_client import SupabaseClient

CST = timezone(timedelta(hours=8))


def main():
    config = load()
    started_at_dt = datetime.now(timezone.utc)
    started_at_ts = time.time()
    now_str = datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] scanner start — pump≥{config.pump_threshold}% / dump≤-{config.dump_threshold}%")

    # 0. 持久层先建好（watchlist monitor 要用）
    supabase = SupabaseClient(config.supabase_url, config.supabase_service_key)

    # 0.5 提前读 state（NewListingsMonitor 需要直接持有 state dict 写入 baseline）
    state = state_mod.prune_expired(state_mod.load(), config.cooldown_min)

    all_signals = []
    fresh_signals = []
    okx_errors = 0
    monitors_run = 0

    try:
        # 1. 跑 monitors
        monitors = [
            SwapTopGainersMonitor(config),
            WatchlistMonitor(config, supabase),
            VolumeSurgeMonitor(config),
            FundingExtremeMonitor(config),
            BreakoutMonitor(config, supabase),
            PriceAlertMonitor(config, supabase),
            OISurgeMonitor(config, supabase),
            PerpPremiumMonitor(config),
            NewListingsMonitor(config, state),
            LongShortRatioMonitor(config),
            # V2.8 新增
            LiquidationsMonitor(config, supabase),
            # CrossExchangeMonitor(config),  ← V2.15 关闭
            # V2.11 新增：链上 + 社交
            WhaleToCexMonitor(config, supabase),
            SocialSurgeMonitor(config, state, supabase),
            # flush_reversal 在 scanner.realtime（5min cron），不在这里
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

        # 2. 冷却去重：V2.8 起 key 升级为 (inst_id, direction, source) 三元组，
        # 避免老逻辑下"同币不同方向"或"同币不同 monitor"互相挤压冷却。
        now_ts = time.time()
        for s in all_signals:
            key = state_mod.make_cooldown_key(s)
            if key in state:
                continue
            fresh_signals.append(s)
            state[key] = now_ts

        if not fresh_signals:
            print("本轮无新信号（可能在冷却期）")
        else:
            # 2.5 信号融合 — 同 inst_id 多 monitor 命中合并打分（V2.9 / Phase 3）
            fresh_signals = fusion_mod.fuse(fresh_signals, time_bucket_min=5)
            high_conf = [s for s in fresh_signals if s.meta.get("confidence_score", 1) >= 3]
            print(f"  [fusion] {len(fresh_signals)} signals → "
                  f"{len({s.meta.get('fusion_group_id', s.inst_id) for s in fresh_signals})} groups, "
                  f"{len(high_conf)} 高置信(≥3 sources)")

            # 3. 排序：先 pump 后 dump，绝对涨跌幅降序
            fresh_signals.sort(key=lambda s: (s.direction != "pump", -abs(s.chg_pct)))
            for s in fresh_signals:
                arrow = "+" if s.chg_pct >= 0 else ""
                conf = s.meta.get("confidence_score", 1)
                tag = "★" * conf
                print(f"  ✓ {s.inst_id} [{s.direction}] {arrow}{s.chg_pct}% "
                      f"vol={s.vol_usdt:.0f}U conf={tag}")

            # 4. 实时通知（飞书）
            notifiers = [
                FeishuNotifier(config.feishu_webhook),
                # V2.7: 邮件汇总走独立 workflow，不在此处实时调用
            ]
            for n in notifiers:
                try:
                    n.send(fresh_signals)
                except Exception as e:
                    print(f"  [{n.name}] notify FAILED: {e}")

            # 5. 持久化（Supabase）
            supabase.insert_signals(fresh_signals)
    finally:
        # 6. heartbeat — 不论成功失败都写一条，watchdog 用
        duration_ms = int((time.time() - started_at_ts) * 1000)
        try:
            supabase.insert_heartbeat({
                "started_at":    started_at_dt.isoformat(),
                "duration_ms":   duration_ms,
                "monitors_run":  monitors_run,
                "signals_found": len(all_signals),
                "fresh_signals": len(fresh_signals),
                "okx_errors":    okx_errors,
                "meta": {
                    "pump_threshold": config.pump_threshold,
                    "dump_threshold": config.dump_threshold,
                    "top_n":          config.top_n,
                },
            })
        except Exception as e:
            print(f"[heartbeat] insert FAILED: {e}")

        # 7. cooldown state + 任何 monitor 写入的 _reserved 键一起落盘
        state_mod.save(state)


if __name__ == "__main__":
    main()
