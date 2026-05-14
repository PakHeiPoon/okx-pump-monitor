"""Social-surge monitor — CoinGecko 热搜趋势监控（V2.11 / V2.17 news enrich）。

底层逻辑：CoinGecko `/search/trending` 返回过去 24h 全球搜索量最高的 15 个币。
**新进入**列表的币代表零售注意力突变，通常先于价格 pump 1-3 天到达。

V2.17 升级：每个新进入的币顺手抓 Google News RSS 2 条最新新闻 + CoinGecko
项目链接 + 项目缩略图。这样 dashboard / Feishu 信号都能直接给出**为什么**这
个币在涨（具体的 catalyst/新闻），不是"trending +24%"干巴巴一行。

为啥不用 LunarCrush：免费层已锁所有 /coins / /topic / /time-series endpoint，
真要拿数据得付 $24/月起。CoinGecko trending 免费无 key、质量同等可用。

LunarCrush key 仍然保留在 env 里，未来升级 Individual 后这个 monitor 可以
切到 LunarCrush 拿更细的社交分（mentions / engagement / galaxy_score 等）。

状态：state.json `_trending_last_seen` 持久化上一轮 trending symbol set，
只对**新进入**的发信号。同一币持续在榜不会反复刷。
"""
import os
import re
import html

import requests

from .base import Monitor, Signal


COINGECKO_TRENDING = "https://api.coingecko.com/api/v3/search/trending"
GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"


def fetch_news_for(coin_name: str, max_items: int = 2):
    """从 Google News RSS 抓最新 N 条新闻标题+链接+来源。
    用 coin_name（如 Gensyn）而非 symbol（如 AI）做查询，避免同名干扰。
    免 key 免认证，但偶尔会 timeout——失败时返回 []，不阻塞主流程。
    """
    if not coin_name:
        return []
    try:
        r = requests.get(
            GOOGLE_NEWS_RSS,
            params={
                "q":    f"{coin_name} crypto",
                "hl":   "en-US",
                "gl":   "US",
                "ceid": "US:en",
            },
            timeout=8,
        )
        r.raise_for_status()
        text = r.text
    except Exception:
        return []

    out = []
    items = re.findall(r"<item>(.*?)</item>", text, re.DOTALL)
    for item in items[:max_items]:
        title_m = re.search(
            r"<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)</title>", item
        )
        link_m = re.search(r"<link>(.*?)</link>", item)
        pub_m = re.search(r"<pubDate>(.*?)</pubDate>", item)
        src_m = re.search(r"<source[^>]*>(.*?)</source>", item)
        title = (
            (title_m.group(1) or title_m.group(2) or "")
            if title_m
            else ""
        )
        title = html.unescape(title).strip()
        link = (link_m.group(1).strip() if link_m else "")
        pub_date = (pub_m.group(1).strip() if pub_m else "")
        src = (src_m.group(1).strip() if src_m else "")
        if not title or not link:
            continue
        out.append({
            "title":  title[:200],
            "url":    link,
            "source": src,
            "pub":    pub_date,
        })
    return out


class SocialSurgeMonitor(Monitor):
    name = "social_surge"

    def __init__(self, config, state, supabase=None):
        self.config = config
        self.state = state                    # 共享 scanner.main 的 state dict
        self.supabase = supabase
        # 只对在 OKX SWAP 有对应合约的 trending 币发信号（你能交易才有意义）
        self.require_okx_swap = os.environ.get("SOCIAL_REQUIRE_OKX_SWAP", "1") == "1"
        # V2.17: 是否在每个新 trending 币上 fetch Google News（每次 +1 HTTP）
        self.enrich_news = os.environ.get("SOCIAL_ENRICH_NEWS", "1") == "1"

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
            coin_id = item.get("id") or item.get("slug")
            thumb_url = item.get("small") or item.get("thumb")
            data_block = item.get("data") or {}
            price_chg = (data_block.get("price_change_percentage_24h") or {}).get("usd")
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

            # V2.17: 富化——抓 2 条最新新闻 + 项目主页
            news_items = []
            if self.enrich_news and name:
                news_items = fetch_news_for(name, max_items=2)

            coingecko_url = f"https://www.coingecko.com/en/coins/{coin_id}" if coin_id else None

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
                    "coin_name":           name,
                    "coin_id":             coin_id,
                    "thumb_url":           thumb_url,
                    "coingecko_url":       coingecko_url,
                    "market_cap_rank":     rank if isinstance(rank, int) else None,
                    "price_change_24h_pct": round(chg, 2),
                    "trending_source":     "coingecko",
                    "news_items":          news_items,   # list[{title, url, source, pub}]
                },
            ))

        # 持久化 current set 给下一轮做差
        self.state[last_seen_key] = current
        return signals
