"""Breakout Monitor —— 突破前高/前低/心理价位。

底层逻辑：用户在 breakout_levels 表里设"BTC 70000 上穿 触发"，scanner 每轮拉
当前价对照所有 enabled level，首次穿越就告警，并写 last_triggered_at 做 24h 冷却。
"""
import time
from datetime import datetime, timedelta, timezone

from .base import Monitor, Signal
from .. import okx


COOLDOWN_HOURS = 24


class BreakoutMonitor(Monitor):
    name = "breakout"

    def __init__(self, config, supabase):
        self.config = config
        self.supabase = supabase

    def scan(self):
        levels = self.supabase.fetch_breakout_levels()
        if not levels:
            return []
        signals = []
        now_utc = datetime.now(timezone.utc)
        cooldown_cutoff = now_utc - timedelta(hours=COOLDOWN_HOURS)
        for row in levels:
            last_triggered = row.get("last_triggered_at")
            if last_triggered:
                try:
                    lt = datetime.fromisoformat(last_triggered.replace("Z", "+00:00"))
                    if lt > cooldown_cutoff:
                        continue
                except Exception:
                    pass
            inst_id = row["inst_id"]
            level_price = float(row["level_price"])
            level_dir = row["direction"]   # 'above' / 'below'
            try:
                last_price = okx.fetch_last_price(inst_id)
            except Exception as e:
                print(f"  [breakout] {inst_id} 拉价失败: {e}")
                continue
            if last_price is None or last_price <= 0:
                continue
            crossed = (
                (level_dir == "above" and last_price >= level_price)
                or (level_dir == "below" and last_price <= level_price)
            )
            if not crossed:
                continue
            distance_pct = (last_price - level_price) / level_price * 100
            signals.append(
                Signal(
                    inst_id=inst_id,
                    direction=level_dir,
                    chg_pct=round(distance_pct, 2),
                    vol_usdt=0,
                    bars=0,
                    open_price=level_price,
                    close_price=last_price,
                    bar_ts_ms=int(time.time() * 1000),
                    source=self.name,
                    meta={
                        "level_price": level_price,
                        "label": row.get("label"),
                        "level_id": row["id"],
                    },
                ),
            )
            self.supabase.update_breakout_triggered(row["id"], now_utc.isoformat())
            time.sleep(0.1)
        return signals
