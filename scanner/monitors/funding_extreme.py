"""Funding Extreme Monitor —— 永续合约资金费率极端值。

底层逻辑：funding rate > +X% 表示多头集中、空头要付费给多头（很多人做多）；
funding rate < -X% 表示空头集中。极端费率往往预示反转或挤压。

扫描范围：TOP N（FUNDING_TOP_N，默认 30）由 24h 涨幅榜前 N 给出，避免扫满市场。
"""
import time

from .base import Monitor, Signal
from .. import okx


class FundingExtremeMonitor(Monitor):
    name = "funding_extreme"

    def __init__(self, config):
        self.config = config

    def scan(self):
        c = self.config
        signals = []
        top = okx.fetch_top_swap_gainers(c.funding_top_n)
        for inst, _chg24h, last in top:
            try:
                rate_data = okx.fetch_funding_rate(inst)
            except Exception as e:
                print(f"  [funding_extreme] {inst} 失败: {e}")
                continue
            if not rate_data:
                continue
            funding_rate_pct = rate_data["funding_rate"] * 100
            if abs(funding_rate_pct) < c.funding_threshold_pct:
                time.sleep(0.05)
                continue
            # 正费率 = 多头付钱 = 多头拥挤 → 标 pump 偏向（潜在空头机会）
            # 负费率 = 空头付钱 = 空头拥挤 → 标 dump 偏向
            direction = "pump" if funding_rate_pct > 0 else "dump"
            signals.append(
                Signal(
                    inst_id=inst,
                    direction=direction,
                    chg_pct=round(funding_rate_pct, 4),  # 用 chg_pct 字段存 funding %
                    vol_usdt=0,
                    bars=0,
                    open_price=last,
                    close_price=last,
                    bar_ts_ms=int(time.time() * 1000),
                    source=self.name,
                    meta={
                        "funding_rate_pct": round(funding_rate_pct, 4),
                        "next_funding_rate_pct": round(
                            rate_data["next_funding_rate"] * 100, 4,
                        ),
                        "next_funding_time_ms": rate_data["next_funding_time_ms"],
                    },
                ),
            )
            time.sleep(0.1)
        return signals
