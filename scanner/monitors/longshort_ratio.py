"""Long/Short Ratio Monitor —— 散户多空账户比极端值（反向信号）。

底层逻辑：OKX rubik 数据提供"散户做多账户/做空账户"比例。极端 ≥3.5
表示散户极度看多（往往顶部）；极端 ≤0.4 表示散户极度看空（往往底部）。
经典反向指标。

扫描范围：仅头部主流币（BTC/ETH/SOL/BNB...等 funding_top_n 个），
不扫 alt（小币散户少，数据噪声大）。
"""
import time

from .base import Monitor, Signal
from .. import okx


class LongShortRatioMonitor(Monitor):
    name = "longshort_ratio"

    def __init__(self, config):
        self.config = config

    def scan(self):
        c = self.config
        signals = []
        # rubik 接口靠 ccy 调用，所以只看主流币
        top = okx.fetch_top_swap_gainers(c.funding_top_n)
        for inst, _chg, last in top:
            try:
                data = okx.fetch_long_short_account_ratio(inst, period="5m")
            except Exception as e:
                print(f"  [longshort_ratio] {inst} 拉比例失败: {e}")
                continue
            if not data:
                continue
            ratio = data["ratio"]
            if ratio >= c.longshort_ratio_high:
                direction = "pump"   # 散户狂热做多 → 反向看跌信号
                bias = "retail FOMO long"
            elif ratio <= c.longshort_ratio_low:
                direction = "dump"   # 散户狂热做空 → 反向看涨信号
                bias = "retail FOMO short"
            else:
                time.sleep(0.05)
                continue
            signals.append(
                Signal(
                    inst_id=inst,
                    direction=direction,
                    chg_pct=round(ratio, 2),
                    vol_usdt=0,
                    bars=0,
                    open_price=last,
                    close_price=last,
                    bar_ts_ms=data["ts_ms"] or int(time.time() * 1000),
                    source=self.name,
                    meta={
                        "ratio": round(ratio, 2),
                        "bias": bias,
                    },
                ),
            )
            time.sleep(0.1)
        return signals
