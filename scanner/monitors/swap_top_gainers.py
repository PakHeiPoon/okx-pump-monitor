"""SWAP 涨幅榜 TOP N + 15 分钟滚动累计 ±X% Monitor。
原 scan.py 的 check_signal 核心逻辑，搬过来抽象成 Monitor。"""
import time

from .base import Monitor, Signal
from .. import okx


class SwapTopGainersMonitor(Monitor):
    name = "swap_top_gainers"

    def __init__(self, config):
        self.config = config

    def scan(self):
        c = self.config
        signals = []
        top = okx.fetch_top_swap_gainers(c.top_n)
        for inst, chg24h, _last in top:
            # 24h 涨幅都不到 3%，跳过加速扫描（保留原逻辑）
            if chg24h * 100 < 3:
                continue
            try:
                hit = self._check_signal(inst)
            except Exception as e:
                print(f"  {inst} 拉K线失败: {e}")
                continue
            if hit:
                signals.append(hit)
            time.sleep(0.1)   # 避免 OKX 限流
        return signals

    def _check_signal(self, inst_id):
        c = self.config
        candles = okx.fetch_1m_candles(inst_id, c.lookback_bars)
        confirmed = [row for row in candles if len(row) > 8 and row[8] == "1"]
        if len(confirmed) < 2:
            return None
        latest = confirmed[0]
        earliest = confirmed[-1]
        open_price = float(earliest[1])
        close_price = float(latest[4])
        if open_price <= 0:
            return None
        chg_pct = (close_price - open_price) / open_price * 100
        total_vol = sum(float(r[7]) if len(r) > 7 else 0 for r in confirmed)
        if total_vol < c.min_vol_usdt:
            return None
        if chg_pct >= c.pump_threshold:
            direction = "pump"
        elif chg_pct <= -c.dump_threshold:
            direction = "dump"
        else:
            return None
        return Signal(
            inst_id=inst_id,
            direction=direction,
            chg_pct=round(chg_pct, 2),
            vol_usdt=round(total_vol, 0),
            bars=len(confirmed),
            open_price=open_price,
            close_price=close_price,
            bar_ts_ms=int(latest[0]),
            source=self.name,
        )
