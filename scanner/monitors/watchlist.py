"""Watchlist 私人盯盘 Monitor。

逻辑：从 Supabase watchlist 表读用户指定的币，对每个币跑 15 分钟滚动累计涨跌幅
检测。阈值默认跟全局一致；若该币在表里有 pump_threshold_override /
dump_threshold_override 字段，则以行内覆盖为准。

与 SwapTopGainersMonitor 的差异：
- 币种来源是 watchlist 表，而不是 OKX 涨幅榜 TOP N
- 不做 24h 涨幅 >= 3% 的预过滤（你指定的就要盯）
- 阈值可 per-coin 覆盖
"""
import time

from .base import Monitor, Signal
from .. import okx


class WatchlistMonitor(Monitor):
    name = "watchlist"

    def __init__(self, config, supabase):
        self.config = config
        self.supabase = supabase

    def scan(self):
        rows = self.supabase.fetch_watchlist()
        if not rows:
            return []
        c = self.config
        signals = []
        for row in rows:
            inst_id = row.get("inst_id")
            if not inst_id:
                continue
            pump_t = row.get("pump_threshold_override")
            dump_t = row.get("dump_threshold_override")
            pump_threshold = float(pump_t) if pump_t is not None else c.pump_threshold
            dump_threshold = float(dump_t) if dump_t is not None else c.dump_threshold
            try:
                hit = self._check_signal(inst_id, pump_threshold, dump_threshold)
            except Exception as e:
                print(f"  [watchlist] {inst_id} 拉K线失败: {e}")
                continue
            if hit:
                signals.append(hit)
            time.sleep(0.1)
        return signals

    def _check_signal(self, inst_id, pump_threshold, dump_threshold):
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
        # watchlist 不卡 vol 下限（你指定的小币就该盯，哪怕量小）
        if chg_pct >= pump_threshold:
            direction = "pump"
        elif chg_pct <= -dump_threshold:
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
