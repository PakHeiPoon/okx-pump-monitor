"""Social-surge monitor — CoinGecko 热搜趋势监控（V2.11）。

底层逻辑：CoinGecko `/search/trending` 返回过去 24h 全球搜索量最高的 15 个币。
**新进入**列表的币代表零售注意力突变，通常先于价格 pump 1-3 天到达。

为啥不用 LunarCrush：免费层已锁所有 /coins / /topic / /time-series endpoint，
真要拿数据得付 $24/月起。CoinGecko trending 免费无 key、质量同等可用。

LunarCrush key 仍然保留在 env 里，未来升级 Individual 后这个 monitor 可以
切到 LunarCrush 拿更细的社交分（mentions / engagement / galaxy_score 等）。

状态：state.json `_trending_last_seen` 持久化上一轮 trending symbol set，
只对**新进入**的发信号。同一币持续在榜不会反复刷。
"""
import os

import requests

from .base import Monitor, Signal


COINGECKO_TRENDING = "https://api.coingecko.com/api/v3/search/trending"


class SocialSurgeMonitor(Monitor):
    name = "social_surge"

    def __init__(self, config, state, supabase=None):
        self.config = config
        self.state = state                    # 共享 scanner.main 的 state dict
        self.supabase = supabase
        # 只对在 OKX SWAP 有对应合约的 trending 币发信号（你能交易才有意义）
        self.require_okx_swap = os.environ.get("SOCIAL_REQUIRE_OKX_SWAP", "1") == "1"

    def scan(self):
        try:
            r = requests.get(COINGECKO_TRENDING, timeout=15)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print(f"  [{self.name}] CoinGecko fetch failed: {e}")
            return []

        coins = data.get("coins") or []
        if not coins:
            return []

        # 拉一遍 OKX universe 拿合法 SWAP inst_id 列表
        known_swaps = self.state.get("_known_swap_inst_ids") or []
        known_set = set(known_swaps) if known_swaps else None

        last_seen_key = "_trending_last_seen"
        last_seen = set(self.state.get(last_seen_key) or [])

        current = []
        signals = []
        for c in coins:
            item = c.get("item", {})
            sym = (item.get("symbol") or "").upper()
            name = item.get("name") or sym
            rank = item.get("market_cap_rank")
            price_chg = (item.get("data") or {}).get("price_change_percentage_24h", {}).get("usd")
            if not sym:
                continue
            current.append(sym)

            # 是不是新进入？
            if sym in last_seen:
                continue

            # OKX SWAP 存在性检查
            inst_id = f"{sym}-USDT-SWAP"
            if self.require_okx_swap and known_set is not None and inst_id not in known_set:
                continue

            try:
                chg = float(price_chg) if price_chg is not None else 0.0
            except (TypeError, ValueError):
                chg = 0.0

            # rank 越小 = 市值越大 = 越显著（小币上热搜价值更大但 noise 也更高）
            signals.append(Signal(
                inst_id=inst_id,
                direction="pump",            # 热搜 = 注意力倾向 = bullish bias
                chg_pct=round(chg, 2),
                vol_usdt=0,
                bars=1,
                open_price=0,
                close_price=0,
                bar_ts_ms=0,
                source=self.name,
                meta={
                    "coin_name":     name,
                    "market_cap_rank": rank if isinstance(rank, int) else None,
                    "price_change_24h_pct": round(chg, 2),
                    "trending_source": "coingecko",
                },
            ))

        # 持久化 current set 给下一轮做差
        self.state[last_seen_key] = current
        return signals
