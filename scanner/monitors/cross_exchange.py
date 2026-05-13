"""Cross-exchange spread monitor — 跨所价差监控（V2.8）。

底层逻辑：单交易所拉升常是噪音；多所同时异动才有真信号。反过来，OKX 相对
其他所价格偏离 ≥ 0.3% 时往往是：
- OKX 偏高 → OKX 在「带头拉」，其他所跟不上 → 短期看涨能量
- OKX 偏低 → OKX 在「带头砸」，其他所没跟下来 → OKX 抛压

监控选 Bitget + Gate.io（两家都不 geo-block 北美 AWS，对 GH Actions / Vercel
都友好）。Binance / Bybit 被 geo-block，留作后续接入（如果以后换中国节点）。

阈值：CROSS_SPREAD_THRESHOLD_PCT（默认 0.3%）。只看 OKX 是 max 或 min 的情况，
OKX 在中间不发信号（无 edge）。
"""
import os

from .base import Monitor, Signal
from .. import okx
from ..exchanges import (
    fetch_bitget_swap_prices,
    fetch_gateio_swap_prices,
    okx_inst_to_base,
)


class CrossExchangeMonitor(Monitor):
    name = "cross_exchange"

    def __init__(self, config):
        self.config = config
        self.spread_threshold_pct = float(
            os.environ.get("CROSS_SPREAD_THRESHOLD_PCT", "0.3")
        )
        # 上限：> 5% 几乎肯定是 token name 碰撞（不同所同名不同币如 "AI"、"XAI"），
        # 不是真实价差。直接跳过。
        self.spread_max_pct = float(
            os.environ.get("CROSS_SPREAD_MAX_PCT", "5.0")
        )
        # 只看 top-N by volume，省 OKX universe 调用并降噪
        self.top_n = int(os.environ.get("CROSS_TOP_N", "50"))

    def scan(self):
        universe = okx.fetch_active_universe(
            top_movers=0, top_volume=self.top_n
        )
        if not universe:
            return []

        bitget = fetch_bitget_swap_prices()
        gate = fetch_gateio_swap_prices()
        if not bitget and not gate:
            print(f"  [{self.name}] no comparable exchange prices fetched")
            return []

        signals = []
        for inst_id, _chg, okx_last in universe:
            base = okx_inst_to_base(inst_id)
            prices = {"okx": okx_last}
            if base in bitget:
                prices["bitget"] = bitget[base]
            if base in gate:
                prices["gate"] = gate[base]
            if len(prices) < 2:
                continue

            max_ex = max(prices, key=lambda k: prices[k])
            min_ex = min(prices, key=lambda k: prices[k])
            max_p = prices[max_ex]
            min_p = prices[min_ex]
            spread_pct = (max_p - min_p) / min_p * 100

            if spread_pct < self.spread_threshold_pct:
                continue
            if spread_pct > self.spread_max_pct:
                # 数据异常 / token 名称碰撞，suppress 并记录
                print(f"  [{self.name}] {base} spread={spread_pct:.1f}% > cap, likely token mismatch")
                continue

            # 只在 OKX 是 outlier 时发信号（OKX 居中=无 edge）
            if max_ex == "okx":
                direction = "pump"     # OKX 偏高，领先涨
            elif min_ex == "okx":
                direction = "dump"     # OKX 偏低，滞涨/抛压先现
            else:
                continue

            signals.append(Signal(
                inst_id=inst_id,
                direction=direction,
                chg_pct=round(spread_pct, 3),
                vol_usdt=0,  # 跨所信号没有"成交量"概念
                bars=len(prices),
                open_price=min_p,
                close_price=max_p,
                bar_ts_ms=0,
                source=self.name,
                meta={
                    "okx_price":     round(okx_last, 8),
                    "bitget_price":  round(bitget.get(base, 0), 8) or None,
                    "gate_price":    round(gate.get(base, 0), 8) or None,
                    "max_exchange":  max_ex,
                    "min_exchange":  min_ex,
                    "spread_pct":    round(spread_pct, 3),
                },
            ))

        return signals
