"""Perp Premium Monitor —— 永续合约相对现货的价差。

底层逻辑：
- swap > spot 越多 → 期货溢价 → 多头狂热 → 反向（空头机会）
- swap < spot 越多 → 期货折价 → 空头狂热 → 反向（多头机会）

实现：扫 TOP N 合约，每个查 swap last + spot last，算 premium%。
"""
import time

from .base import Monitor, Signal
from .. import okx


class PerpPremiumMonitor(Monitor):
    name = "perp_premium"

    def __init__(self, config):
        self.config = config

    def scan(self):
        c = self.config
        signals = []
        # 每个币要 2 个 API call（swap + spot），universe 控制在 50（top_movers only）
        # 不掺杂 vol 榜了，太慢
        top = okx.fetch_active_universe(top_movers=c.top_n, top_volume=0)
        for inst, _chg, _last in top:
            spot_pair = inst.replace("-SWAP", "")  # BTC-USDT-SWAP → BTC-USDT
            try:
                swap_price = okx.fetch_last_price(inst)
                spot_price = okx.fetch_spot_last_price(spot_pair)
            except Exception as e:
                print(f"  [perp_premium] {inst} 拉价失败: {e}")
                continue
            if not swap_price or not spot_price or spot_price <= 0:
                continue
            premium_pct = (swap_price - spot_price) / spot_price * 100
            if abs(premium_pct) < c.perp_premium_threshold_pct:
                time.sleep(0.05)
                continue
            direction = "pump" if premium_pct > 0 else "dump"
            signals.append(
                Signal(
                    inst_id=inst,
                    direction=direction,
                    chg_pct=round(premium_pct, 3),
                    vol_usdt=0,
                    bars=0,
                    open_price=spot_price,
                    close_price=swap_price,
                    bar_ts_ms=int(time.time() * 1000),
                    source=self.name,
                    meta={
                        "spot_price": spot_price,
                        "swap_price": swap_price,
                        "premium_pct": round(premium_pct, 3),
                    },
                ),
            )
            time.sleep(0.1)
        return signals
