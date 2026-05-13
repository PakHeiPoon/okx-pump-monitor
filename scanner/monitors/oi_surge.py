"""OI Surge Monitor —— 持仓量短期剧变。

底层逻辑：OI 短时间 ±N% 通常代表主力建仓/平仓（不是散户单子能撬动）。
- ΔOI > +N%: 大量新仓位涌入（注意是涨是跌看价格 direction 判断多空）
- ΔOI < -N%: 大量平仓（可能止盈结束行情，或被强制平仓）

实现：每次 scan 从 OKX 拉全量当前 OI，跟 Supabase oi_snapshots 上次值比，
然后 upsert 最新值。第一次跑（snapshot 表空）不会出信号——是 baseline。
"""
import time

from .base import Monitor, Signal
from .. import okx


class OISurgeMonitor(Monitor):
    name = "oi_surge"

    def __init__(self, config, supabase):
        self.config = config
        self.supabase = supabase
        # 阈值从 env 读，默认 ±10%
        self.threshold_pct = self._get_threshold_pct()

    @staticmethod
    def _get_threshold_pct():
        import os
        return float(os.environ.get("OI_SURGE_THRESHOLD_PCT", "10.0"))

    def scan(self):
        # 仅在 Supabase 配置好时才跑（没 DB 没法存 baseline）
        if not self.supabase.enabled:
            return []
        try:
            current = okx.fetch_all_open_interest()
        except Exception as e:
            print(f"  [oi_surge] 拉 OI 失败: {e}")
            return []
        if not current:
            return []

        previous = self.supabase.fetch_oi_snapshots()

        signals = []
        # 限制对比范围到 active universe（避免噪声小币 OI 抖动报错信号）
        top_set = set()
        try:
            top = okx.fetch_active_universe(
                top_movers=self.config.top_n,
                top_volume=self.config.top_n * 2,
            )
            top_set = {t[0] for t in top}
        except Exception as e:
            print(f"  [oi_surge] 拉 universe 失败: {e}")

        # 只对 TOP N 内的币做对比，但全量 upsert（攒 baseline 给下次）
        for row in current:
            inst = row["inst_id"]
            if not top_set or inst in top_set:
                prev_row = previous.get(inst)
                if prev_row:
                    prev_oi = float(prev_row.get("oi") or 0)
                    if prev_oi > 0:
                        delta_pct = (row["oi"] - prev_oi) / prev_oi * 100
                        if abs(delta_pct) >= self.threshold_pct:
                            direction = "pump" if delta_pct > 0 else "dump"
                            signals.append(
                                Signal(
                                    inst_id=inst,
                                    direction=direction,
                                    chg_pct=round(delta_pct, 2),
                                    vol_usdt=round(row.get("oi_usd") or 0, 0),
                                    bars=0,
                                    open_price=prev_oi,
                                    close_price=row["oi"],
                                    bar_ts_ms=row["ts_ms"] or int(time.time() * 1000),
                                    source=self.name,
                                    meta={
                                        "prev_oi": prev_oi,
                                        "current_oi": row["oi"],
                                        "current_oi_usd": row.get("oi_usd"),
                                        "delta_pct": round(delta_pct, 2),
                                    },
                                ),
                            )
        # baseline 全量 upsert（包括不在 TOP N 的），下次 scan 才能算 delta
        self.supabase.upsert_oi_snapshots(current)
        return signals
