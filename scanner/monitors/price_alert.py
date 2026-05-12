"""Price Alert Monitor —— 用户自定义目标价 / 止损价。

底层逻辑：你给 PENGU 设"价到 0.5 触发"，scanner 检测穿越后告警，并把
triggered_at 写库。**一次性告警**——触发后该 alert 不会再响（直到你 reset）。
"""
import time
from datetime import datetime, timezone

from .base import Monitor, Signal
from .. import okx


class PriceAlertMonitor(Monitor):
    name = "price_alert"

    def __init__(self, config, supabase):
        self.config = config
        self.supabase = supabase

    def scan(self):
        alerts = self.supabase.fetch_active_price_alerts()
        if not alerts:
            return []
        signals = []
        now_utc = datetime.now(timezone.utc)
        for row in alerts:
            inst_id = row["inst_id"]
            target_price = float(row["target_price"])
            level_dir = row["direction"]
            try:
                last_price = okx.fetch_last_price(inst_id)
            except Exception as e:
                print(f"  [price_alert] {inst_id} 拉价失败: {e}")
                continue
            if last_price is None or last_price <= 0:
                continue
            crossed = (
                (level_dir == "above" and last_price >= target_price)
                or (level_dir == "below" and last_price <= target_price)
            )
            if not crossed:
                continue
            distance_pct = (last_price - target_price) / target_price * 100
            signals.append(
                Signal(
                    inst_id=inst_id,
                    direction=level_dir,
                    chg_pct=round(distance_pct, 2),
                    vol_usdt=0,
                    bars=0,
                    open_price=target_price,
                    close_price=last_price,
                    bar_ts_ms=int(time.time() * 1000),
                    source=self.name,
                    meta={
                        "target_price": target_price,
                        "alert_type": row.get("alert_type"),
                        "note": row.get("note"),
                        "alert_id": row["id"],
                    },
                ),
            )
            # 一次性告警：标记 triggered，下次 scan 自动过滤掉
            self.supabase.mark_price_alert_triggered(row["id"], now_utc.isoformat())
            time.sleep(0.1)
        return signals
