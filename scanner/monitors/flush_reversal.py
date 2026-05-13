"""Flush-reversal monitor —「闪崩 V 反弹」/ trap-and-reverse 形态（V2.10）。

底层逻辑（你以 UB-USDT-SWAP 19:08-19:28 那波举例）：
1. 强势上涨币创出近 30min 局部新高（如 0.21762）
2. 高点之后 ≤ 15min 内出现 ≥ 8% 闪崩（杀多）
3. 当前价已经从最低点回弹 ≥ 30% 跌幅（V-bottom 已确立）
4. 闪崩窗口的 1m 总成交额 ≥ 前 30min 均值 × 3（确认是被动盘 / 强平洪流）
5. 这个币必须在 24h 涨幅榜里（过滤垃圾币的噪音波动）

机会本质：长仓被洗 → 抛压枯竭 → 空头在低位入场会被挤压 → 价格回归。
专业称呼："blow-off top → long flush → short squeeze"。

【实时性】本 monitor 当前在 15min cron 下，V-bottom 后 0-15 分钟内可识别。
反弹通常持续 10-60min，足够操作。升级 5min cron 或 Vercel Pro 1min 可显著
提速。WebSocket 是终极态。

【环境变量】
- FLUSH_LOOKBACK_MIN          (30)  1m K 线 lookback 总分钟数
- FLUSH_MIN_DROP_PCT          (8.0) 峰谷最小跌幅%
- FLUSH_PEAK_TROUGH_MAX_MIN   (15)  峰到谷允许的最大耗时
- FLUSH_MIN_RECOVERY_PCT      (30.0) 当前价回弹至少占跌幅多少%
- FLUSH_VOL_MULTIPLIER        (3.0) 闪崩窗口 vol vs baseline 倍数
- FLUSH_REQUIRE_24H_GAINER_PCT (5.0) 仅扫 24h 涨幅 ≥ 该值的币
- FLUSH_TOP_N                 (60)  只看 24h chg / volume 前 N
"""
import os
import time

from .base import Monitor, Signal
from .. import okx


class FlushReversalMonitor(Monitor):
    name = "flush_reversal"

    def __init__(self, config):
        self.config = config
        self.lookback_min            = int(os.environ.get("FLUSH_LOOKBACK_MIN", "30"))
        self.min_drop_pct            = float(os.environ.get("FLUSH_MIN_DROP_PCT", "8.0"))
        self.peak_trough_max_min     = int(os.environ.get("FLUSH_PEAK_TROUGH_MAX_MIN", "15"))
        self.min_recovery_pct        = float(os.environ.get("FLUSH_MIN_RECOVERY_PCT", "30.0"))
        self.vol_multiplier          = float(os.environ.get("FLUSH_VOL_MULTIPLIER", "3.0"))
        self.require_24h_gainer_pct  = float(os.environ.get("FLUSH_REQUIRE_24H_GAINER_PCT", "5.0"))
        self.top_n                   = int(os.environ.get("FLUSH_TOP_N", "60"))

    def scan(self):
        signals = []
        # 只看 24h chg ≥ 阈值且在 TOP_N 里的活跃币
        universe = okx.fetch_active_universe(
            top_movers=self.top_n, top_volume=self.top_n
        )
        candidates = [
            (inst, chg, last)
            for inst, chg, last in universe
            if chg * 100 >= self.require_24h_gainer_pct
        ]
        for inst_id, _chg24h, _last in candidates:
            try:
                hit = self._check(inst_id)
            except Exception as e:
                print(f"  [{self.name}] {inst_id} 拉K线失败: {e}")
                continue
            if hit:
                signals.append(hit)
            time.sleep(0.05)
        return signals

    def _check(self, inst_id):
        # 拉 lookback + baseline 共 2*lookback 分钟的 1m K 线
        # OKX 返回最新在前，过滤 confirmed
        n_needed = self.lookback_min * 2
        candles = okx.fetch_1m_candles(inst_id, n_needed)
        confirmed = [c for c in candles if len(c) > 8 and c[8] == "1"]
        if len(confirmed) < n_needed - 2:
            return None

        # 翻成正序（时间升序）
        bars = list(reversed(confirmed))
        latest = bars[-1]
        window = bars[-self.lookback_min:]
        baseline = bars[-2 * self.lookback_min:-self.lookback_min]
        if len(window) < self.lookback_min // 2 or len(baseline) < self.lookback_min // 2:
            return None

        # 在 window 内找峰和谷
        peak_idx = max(range(len(window)), key=lambda i: float(window[i][2]))  # high
        peak_high = float(window[peak_idx][2])
        peak_ts = int(window[peak_idx][0])

        # 谷必须在峰之后
        post_peak = window[peak_idx:]
        if len(post_peak) < 2:
            return None
        trough_idx_in_post = min(range(len(post_peak)), key=lambda i: float(post_peak[i][3]))  # low
        trough_low = float(post_peak[trough_idx_in_post][3])
        trough_ts = int(post_peak[trough_idx_in_post][0])

        if peak_high <= 0:
            return None
        drop_pct = (peak_high - trough_low) / peak_high * 100
        if drop_pct < self.min_drop_pct:
            return None

        # 峰谷耗时检查
        peak_trough_min = (trough_ts - peak_ts) / 60_000
        if peak_trough_min <= 0 or peak_trough_min > self.peak_trough_max_min:
            return None

        # 反弹幅度（从谷回弹相对于峰谷跌幅占比）
        current_close = float(latest[4])
        if current_close <= trough_low:
            return None
        recovery_pct = (current_close - trough_low) / (peak_high - trough_low) * 100
        if recovery_pct < self.min_recovery_pct:
            return None

        # 反弹时间窗口：谷之后不超过 lookback_min（避免抓老 V）
        latest_ts = int(latest[0])
        post_trough_min = (latest_ts - trough_ts) / 60_000
        if post_trough_min > self.lookback_min:
            return None

        # Volume 校验：从峰到谷这段 vs baseline 均值
        peak_ts_idx = bars.index(window[peak_idx])
        trough_ts_idx = bars.index(post_peak[trough_idx_in_post])
        flush_bars = bars[peak_ts_idx : trough_ts_idx + 1]
        flush_vol = sum(float(b[7]) for b in flush_bars) / max(1, len(flush_bars))
        baseline_vol = sum(float(b[7]) for b in baseline) / max(1, len(baseline))
        if baseline_vol <= 0:
            return None
        vol_mult = flush_vol / baseline_vol
        if vol_mult < self.vol_multiplier:
            return None

        return Signal(
            inst_id=inst_id,
            direction="pump",            # V-bottom 反弹做多机会
            chg_pct=round(recovery_pct, 2),
            vol_usdt=round(sum(float(b[7]) for b in flush_bars), 0),
            bars=len(flush_bars),
            open_price=trough_low,        # entry 锚点
            close_price=current_close,
            bar_ts_ms=latest_ts,
            source=self.name,
            meta={
                "peak_price":      round(peak_high, 8),
                "trough_price":    round(trough_low, 8),
                "drop_pct":        round(drop_pct, 2),
                "recovery_pct":    round(recovery_pct, 2),
                "peak_trough_min": round(peak_trough_min, 1),
                "post_trough_min": round(post_trough_min, 1),
                "vol_multiplier":  round(vol_mult, 1),
            },
        )
