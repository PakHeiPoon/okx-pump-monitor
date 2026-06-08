"""Slow flush-reversal monitor —「慢洗 V 反弹」/ trap-and-reverse 长周期版（V2.22）。

跟 FlushReversalMonitor（15min 闪崩）的区别：

  FlushReversal:      peak→trough ≤ 15min   "blow-off → flash crash → squeeze"
  SlowFlushReversal:  peak→trough 30min-4h   "topping → 持续杀多 → 横盘洗筹 → V 反弹"

底层逻辑（用户 2026-06-07 ALLO 那波举例）：
  03:15  peak 0.486
  06:55  trough 0.299  （4h 慢跌 -38.5%，多头被反复止损）
  06:55-12:00  底部横盘 5h（V 形右侧建仓窗口）
  之后   反弹至 0.54（+80% from trough）

机会本质：不像闪崩有「插针 → 立即反弹」的尖底，慢洗的底部会反复试探，
让左侧抄底的人被洗 1-2 次。一旦突破底部 range 上沿就是确认信号。

【时序】配 5min cron 跑，5m K 线 lookback 8h（96 根），冷却 30min。

【环境变量】
- SLOW_FLUSH_LOOKBACK_BARS      (96)   5m K 线总数 = 8h
- SLOW_FLUSH_MIN_DROP_PCT       (25.0) 峰→谷最小跌幅%（高门槛防噪音）
- SLOW_FLUSH_PEAK_TROUGH_MIN_BARS (6) 峰→谷最少 5m 数（30min）—— 短于此走 FlushReversal
- SLOW_FLUSH_PEAK_TROUGH_MAX_BARS (60) 峰→谷最多 5m 数（5h）—— ALLO 6/7 那次 4h5min 命中
- SLOW_FLUSH_MIN_BASE_BARS      (6)    谷之后至少在 trough+3% 内停留 N 根（30min 底部）
- SLOW_FLUSH_MIN_RECOVERY_PCT   (20.0) 从底部反弹至少占跌幅%（V-bottom 已确立）
- SLOW_FLUSH_MAX_RECOVERY_PCT   (60.0) 反弹超过此值就太晚了，不再发信
- SLOW_FLUSH_VOL_MULTIPLIER     (1.2)  flush 段 vol vs baseline 均值倍数 —— 慢洗 vol 增幅比闪崩温和
- SLOW_FLUSH_REQUIRE_24H_GAINER_PCT (20.0) 仅扫 24h ≥ 该值的妖币
- SLOW_FLUSH_TOP_N              (40)   universe 大小
"""
import os
import time

from .base import Monitor, Signal
from .. import okx


class SlowFlushReversalMonitor(Monitor):
    name = "slow_flush_reversal"

    def __init__(self, config):
        self.config = config
        self.lookback_bars       = int(os.environ.get("SLOW_FLUSH_LOOKBACK_BARS", "96"))
        self.min_drop_pct        = float(os.environ.get("SLOW_FLUSH_MIN_DROP_PCT", "25.0"))
        self.pt_min_bars         = int(os.environ.get("SLOW_FLUSH_PEAK_TROUGH_MIN_BARS", "6"))
        self.pt_max_bars         = int(os.environ.get("SLOW_FLUSH_PEAK_TROUGH_MAX_BARS", "60"))
        self.min_base_bars       = int(os.environ.get("SLOW_FLUSH_MIN_BASE_BARS", "6"))
        self.min_recovery_pct    = float(os.environ.get("SLOW_FLUSH_MIN_RECOVERY_PCT", "20.0"))
        self.max_recovery_pct    = float(os.environ.get("SLOW_FLUSH_MAX_RECOVERY_PCT", "60.0"))
        self.vol_multiplier      = float(os.environ.get("SLOW_FLUSH_VOL_MULTIPLIER", "1.2"))
        self.require_24h_gainer  = float(os.environ.get("SLOW_FLUSH_REQUIRE_24H_GAINER_PCT", "20.0"))
        self.top_n               = int(os.environ.get("SLOW_FLUSH_TOP_N", "40"))

    def scan(self):
        signals = []
        universe = okx.fetch_active_universe(
            top_movers=self.top_n, top_volume=self.top_n
        )
        candidates = [
            (inst, chg, last)
            for inst, chg, last in universe
            if chg * 100 >= self.require_24h_gainer
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
        # 拉 lookback + baseline = 2*lookback 根 5m K 线
        n_needed = self.lookback_bars * 2
        candles = okx.fetch_candles(inst_id, "5m", n_needed)
        confirmed = [c for c in candles if len(c) > 8 and c[8] == "1"]
        if len(confirmed) < n_needed * 0.8:
            return None

        # OKX 最新在前 → 翻成正序
        bars = list(reversed(confirmed))
        latest = bars[-1]
        window = bars[-self.lookback_bars:]
        baseline = bars[-2 * self.lookback_bars:-self.lookback_bars]
        if len(window) < self.lookback_bars // 2 or len(baseline) < self.lookback_bars // 2:
            return None

        # window 内找峰 — 峰必须不在 window 最末段（否则没有 trough 空间）
        # 至少留出 pt_min_bars + min_base_bars + 1 给 trough+base
        max_peak_idx = len(window) - (self.pt_min_bars + self.min_base_bars + 1)
        if max_peak_idx <= 0:
            return None
        peak_idx = max(range(max_peak_idx + 1), key=lambda i: float(window[i][2]))
        peak_high = float(window[peak_idx][2])
        peak_ts = int(window[peak_idx][0])

        # 谷在峰之后
        post_peak = window[peak_idx:]
        trough_idx_in_post = min(range(len(post_peak)), key=lambda i: float(post_peak[i][3]))
        trough_low = float(post_peak[trough_idx_in_post][3])
        trough_ts = int(post_peak[trough_idx_in_post][0])

        if peak_high <= 0:
            return None
        drop_pct = (peak_high - trough_low) / peak_high * 100
        if drop_pct < self.min_drop_pct:
            return None

        # 峰→谷跨度（5m 根数）
        pt_bars = trough_idx_in_post  # post_peak[0] = peak
        if pt_bars < self.pt_min_bars or pt_bars > self.pt_max_bars:
            return None

        # 底部停留检查：谷之后至少 min_base_bars 根 candles 全部 low ≥ trough_low * 0.97
        # （允许底部反复试探 3% 以内，否则就是直接 V，更适合 FlushReversal）
        post_trough = post_peak[trough_idx_in_post + 1:]
        if len(post_trough) < self.min_base_bars:
            return None
        base_zone = post_trough[:self.min_base_bars]
        base_threshold = trough_low * 0.97
        if any(float(b[3]) < base_threshold for b in base_zone):
            return None

        # 反弹幅度
        current_close = float(latest[4])
        if current_close <= trough_low:
            return None
        recovery_pct = (current_close - trough_low) / (peak_high - trough_low) * 100
        if recovery_pct < self.min_recovery_pct or recovery_pct > self.max_recovery_pct:
            return None

        # Volume 校验：flush 段（peak→trough）vs baseline 均值
        peak_global_idx = bars.index(window[peak_idx])
        trough_global_idx = bars.index(post_peak[trough_idx_in_post])
        flush_bars = bars[peak_global_idx : trough_global_idx + 1]
        flush_vol = sum(float(b[7]) for b in flush_bars) / max(1, len(flush_bars))
        baseline_vol = sum(float(b[7]) for b in baseline) / max(1, len(baseline))
        if baseline_vol <= 0:
            return None
        vol_mult = flush_vol / baseline_vol
        if vol_mult < self.vol_multiplier:
            return None

        latest_ts = int(latest[0])
        pt_min = pt_bars * 5  # 5m bars → minutes
        post_trough_min = (latest_ts - trough_ts) / 60_000

        return Signal(
            inst_id=inst_id,
            direction="pump",
            chg_pct=round(recovery_pct, 2),
            vol_usdt=round(sum(float(b[7]) for b in flush_bars), 0),
            bars=len(flush_bars),
            open_price=trough_low,
            close_price=current_close,
            bar_ts_ms=latest_ts,
            source=self.name,
            meta={
                "peak_price":      round(peak_high, 8),
                "trough_price":    round(trough_low, 8),
                "drop_pct":        round(drop_pct, 2),
                "recovery_pct":    round(recovery_pct, 2),
                "peak_trough_min": pt_min,
                "post_trough_min": round(post_trough_min, 1),
                "base_bars":       self.min_base_bars,
                "vol_multiplier":  round(vol_mult, 1),
            },
        )
