"""Liquidations monitor — 强平爆仓密集监控（V2.8）。

底层逻辑：大额连环强平往往**领先**爆拉/闪崩 1-5 分钟。
- posSide=long  被强平 → 多头爆仓 → 抛压 → "dump" 信号
- posSide=short 被强平 → 空头爆仓 → 轧空 → "pump" 信号

聚合策略：对每个 uly（top-N by 24h vol），fetch 最近 100 条强平，
过滤到最近 LIQ_WINDOW_MIN 分钟内，按 inst_id 汇总：
- long_liq_usd, short_liq_usd
- 任意一边 ≥ LIQ_NOTIONAL_THRESHOLD ($1M default) → 触发 Signal

API 预算：fetch_swap_instruments() 1 次（取 ctVal）+ N 次 liquidation-orders
（N = LIQ_TOP_N，默认 30）≈ 31 次 OKX call per scan run。

未来优化（Tier 2）：把 details 也写 Supabase liquidations 表，dashboard
/markets 可以展示实时爆仓流。本 monitor 已经预备好 supabase 参数，等
v28_migration.sql 跑过后自动开始写库。
"""
import os
import time

from .base import Monitor, Signal
from .. import okx


class LiquidationsMonitor(Monitor):
    name = "liquidations"

    def __init__(self, config, supabase=None):
        self.config = config
        self.supabase = supabase
        # 阈值通过 env 配，避免 config.py 膨胀。defaults are conservative。
        self.notional_threshold = float(
            os.environ.get("LIQ_NOTIONAL_THRESHOLD", "1000000")  # $1M
        )
        self.window_min = int(os.environ.get("LIQ_WINDOW_MIN", "5"))
        self.top_n = int(os.environ.get("LIQ_TOP_N", "30"))

    def scan(self):
        signals = []
        # 取 top-N by 24h volume — 大币更可能有可观察的爆仓集中度。
        # 小币就算 100% 全爆也可能不到 $1M，没意义。
        universe = okx.fetch_active_universe(top_movers=0, top_volume=self.top_n)
        if not universe:
            return []

        # 一次性拉所有 SWAP 的 ctVal（合约面值）
        instruments = okx.fetch_swap_instruments()

        # 用 uly 去重：BTC-USDT-SWAP / ETH-USDT-SWAP 的 uly 是 BTC-USDT / ETH-USDT
        ulys_seen = set()
        all_liq_rows = []  # 留给 supabase 落地用

        for inst_id, _chg, _last in universe:
            inst_meta = instruments.get(inst_id)
            if not inst_meta:
                continue
            uly = inst_meta["uly"]
            ct_val = inst_meta["ct_val"]
            if not uly or uly in ulys_seen or ct_val <= 0:
                continue
            ulys_seen.add(uly)

            try:
                events = okx.fetch_liquidation_orders(uly, limit=100)
            except Exception as e:
                print(f"  [liquidations] {uly} fetch failed: {e}")
                continue
            time.sleep(0.05)  # 限流缓冲

            now_ms = time.time() * 1000
            window_ms = self.window_min * 60 * 1000
            recent = [e for e in events if now_ms - e["ts_ms"] <= window_ms]
            if not recent:
                continue

            # 按 inst_id 分组，再算多空 notional
            by_inst = {}
            for e in recent:
                d = by_inst.setdefault(e["inst_id"], {"long_usd": 0.0, "short_usd": 0.0, "count": 0, "events": []})
                notional = e["sz"] * ct_val * e["bk_px"]
                if e["pos_side"] == "long":
                    d["long_usd"] += notional
                else:
                    d["short_usd"] += notional
                d["count"] += 1
                d["events"].append({**e, "notional_usd": notional})

            for inst_id_h, agg in by_inst.items():
                total = agg["long_usd"] + agg["short_usd"]
                if total < self.notional_threshold:
                    continue

                long_dominant = agg["long_usd"] > agg["short_usd"]
                direction = "dump" if long_dominant else "pump"
                # 用主导方爆仓占比作为 chg_pct（带符号：long 主导→负=抛压；short 主导→正=轧空）
                imbalance = (agg["short_usd"] - agg["long_usd"]) / total * 100  # -100~+100

                # open/close 用最早和最晚事件的 bkPx（近似）
                evts_sorted = sorted(agg["events"], key=lambda x: x["ts_ms"])
                open_px = evts_sorted[0]["bk_px"]
                close_px = evts_sorted[-1]["bk_px"]
                latest_ts = evts_sorted[-1]["ts_ms"]

                signals.append(Signal(
                    inst_id=inst_id_h,
                    direction=direction,
                    chg_pct=round(imbalance, 2),
                    vol_usdt=round(total, 0),
                    bars=agg["count"],
                    open_price=open_px,
                    close_price=close_px,
                    bar_ts_ms=int(latest_ts),
                    source=self.name,
                    meta={
                        "long_liq_usd":  round(agg["long_usd"], 0),
                        "short_liq_usd": round(agg["short_usd"], 0),
                        "window_min":    self.window_min,
                        "event_count":   agg["count"],
                    },
                ))

                # 持久化到 supabase liquidations 表（如果配了）
                if self.supabase:
                    rows = [
                        {
                            "inst_id":      inst_id_h,
                            "side":         "long" if e["pos_side"] == "long" else "short",
                            "price":        e["bk_px"],
                            "sz":           e["sz"],
                            "notional_usd": round(e["notional_usd"], 2),
                            "ts":           okx_ts_iso(e["ts_ms"]),
                        }
                        for e in agg["events"]
                    ]
                    all_liq_rows.extend(rows)

        if self.supabase and all_liq_rows:
            self.supabase.insert_liquidations(all_liq_rows)

        return signals


def okx_ts_iso(ts_ms: int) -> str:
    """毫秒时间戳 → ISO8601 UTC string (Supabase timestamptz 友好)。"""
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts_ms / 1000, timezone.utc).isoformat()
