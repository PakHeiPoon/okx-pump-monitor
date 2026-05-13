"""Volume Surge Monitor —— 放量但价格相对稳定。

底层逻辑：当前 1m 成交额 > 最近 N 根均值 × 倍数，同时 15min 累计价格变化 < 阈值。
这是典型的"资金潜伏"信号——大单进场但还没拉盘。
扫描范围：跟 SwapTopGainersMonitor 一样的 TOP N 涨幅榜（避免扫全市场太慢）。
"""
import time

from .base import Monitor, Signal
from .. import okx


class VolumeSurgeMonitor(Monitor):
    name = "volume_surge"

    def __init__(self, config):
        self.config = config

    def scan(self):
        c = self.config
        signals = []
        # universe 同 swap_top_gainers：覆盖陡变 + 高成交量
        top = okx.fetch_active_universe(top_movers=c.top_n, top_volume=c.top_n * 2)
        for inst, _chg24h, _last in top:
            try:
                hit = self._check_surge(inst)
            except Exception as e:
                print(f"  [volume_surge] {inst} 失败: {e}")
                continue
            if hit:
                signals.append(hit)
            time.sleep(0.1)
        return signals

    def _check_surge(self, inst_id):
        c = self.config
        # 多拉一根（最新可能未收盘），用 confirmed 算
        candles = okx.fetch_1m_candles(inst_id, c.vol_surge_window + 1)
        confirmed = [row for row in candles if len(row) > 8 and row[8] == "1"]
        if len(confirmed) < c.vol_surge_window:
            return None
        latest = confirmed[0]
        baseline = confirmed[1 : c.vol_surge_window + 1]
        latest_vol = float(latest[7]) if len(latest) > 7 else 0
        baseline_vols = [float(r[7]) if len(r) > 7 else 0 for r in baseline]
        avg_vol = sum(baseline_vols) / len(baseline_vols) if baseline_vols else 0
        if avg_vol <= 0:
            return None
        multiplier = latest_vol / avg_vol
        if multiplier < c.vol_surge_multiplier:
            return None

        # 价格相对稳定校验
        open_price = float(latest[1])
        close_price = float(latest[4])
        if open_price <= 0:
            return None
        chg_pct = (close_price - open_price) / open_price * 100
        if abs(chg_pct) > c.vol_surge_max_abs_chg_pct:
            return None

        # 最低绝对成交额过滤（避免冷门小币假信号）
        if latest_vol < c.min_vol_usdt:
            return None

        direction = "pump" if chg_pct >= 0 else "dump"
        return Signal(
            inst_id=inst_id,
            direction=direction,
            chg_pct=round(chg_pct, 2),
            vol_usdt=round(latest_vol, 0),
            bars=1,
            open_price=open_price,
            close_price=close_price,
            bar_ts_ms=int(latest[0]),
            source=self.name,
            meta={
                "vol_multiplier": round(multiplier, 1),
                "baseline_avg_vol": round(avg_vol, 0),
                "window_bars": c.vol_surge_window,
            },
        )
