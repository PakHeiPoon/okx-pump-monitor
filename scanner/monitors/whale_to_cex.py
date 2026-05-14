"""Whale-to-CEX monitor — 大额 USDT/USDC 转入交易所（V2.11）。

底层逻辑：大额 stablecoin 转入 CEX 热钱包 = 砸盘/卖出预备。
- "from 任意" "to Binance/Coinbase/OKX 等热钱包" 是核心信号
- 单笔 ≥ $500K 或 15min 内累计 ≥ $5M → 触发 dump 信号

数据源：Etherscan V2 API（chainid=1 主网），免费 100k req/day。
追加 USDC + ETH 后总计 ~3 tokens × 8 CEX = 24 calls/run = 96 runs/day =
2304 calls/day（占 2.3% 配额，宽裕）。

直接监 hot wallets（地址公开，多年稳定）：CEX_HOT_WALLETS 字典。
更激进可加 Coinbase Prime / Bitfinex / Crypto.com，但 8 大所已经覆盖
绝大部分 USDT 流转。

注意：whale 信号不绑特定币种 → inst_id 用 'WHALE-INFLOW-{EXCHANGE}'
作为合成 key。dashboard SignalCard 已经 graceful，能渲染这类合成 ID。
"""
import os
import time

import requests

from .base import Monitor, Signal


ETHERSCAN_V2 = "https://api.etherscan.io/v2/api"

# ERC-20 stablecoin contracts on Ethereum mainnet
TOKEN_CONTRACTS = {
    "USDT": {"addr": "0xdAC17F958D2ee523a2206206994597C13D831ec7", "decimals": 6},
    "USDC": {"addr": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "decimals": 6},
}

# 已知 CEX hot wallets（地址公开，多年稳定。可在 etherscan label cloud 验证）
CEX_HOT_WALLETS = {
    "Binance":  "0x28C6c06298d514Db089934071355E5743bf21d60",
    "Binance2": "0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549",
    "Binance3": "0xDFd5293D8e347dFe59E90eFd55b2956a1343963d",
    "Coinbase": "0x71660c4005BA85c37ccec55d0C4493E66Fe775d3",
    "Coinbase2": "0x503828976D22510aad0201ac7EC88293211D23Da",
    "OKX":      "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b",
    "Kraken":   "0x267be1C1D684F78cb4F6a176C4911b741E4Ffdc0",
    "Bybit":    "0xf89d7b9c864f589bbF53a82105107622B35EaA40",
}


class WhaleToCexMonitor(Monitor):
    name = "whale_to_cex"

    def __init__(self, config, supabase=None):
        self.config = config
        self.supabase = supabase
        self.api_key                = os.environ.get("ETHERSCAN_KEY", "")
        self.single_tx_min_usd      = float(os.environ.get("WHALE_SINGLE_TX_MIN_USD", "500000"))
        self.cumulative_min_usd     = float(os.environ.get("WHALE_CUMULATIVE_MIN_USD", "5000000"))
        self.window_min             = int(os.environ.get("WHALE_WINDOW_MIN", "15"))

    def scan(self):
        if not self.api_key:
            print(f"  [{self.name}] ETHERSCAN_KEY not set, skipping")
            return []

        now_ts = int(time.time())
        window_start_ts = now_ts - self.window_min * 60

        # exchange -> {total_usd, txs: [{hash, value_usd, ts, token, from}]}
        agg = {}

        for label, addr in CEX_HOT_WALLETS.items():
            for token_sym, token_meta in TOKEN_CONTRACTS.items():
                try:
                    txs = self._fetch_recent_inflow(addr, token_meta["addr"], offset=100)
                except Exception as e:
                    print(f"  [{self.name}] {label} {token_sym} fetch failed: {e}")
                    continue
                time.sleep(0.25)   # Etherscan 5 req/sec free limit

                for tx in txs:
                    try:
                        ts = int(tx["timeStamp"])
                        if ts < window_start_ts:
                            break  # tokentx 已 sort desc，旧的就停
                        # 只看 incoming（to == CEX address）
                        if tx["to"].lower() != addr.lower():
                            continue
                        # 过滤 self-transfer / internal
                        if tx["from"].lower() == addr.lower():
                            continue
                        raw_value = int(tx["value"])
                        decimals = int(tx["tokenDecimal"])
                        # USDT/USDC 都是 1:1 USD（稳定币假设）
                        value_usd = raw_value / (10 ** decimals)
                        if value_usd < self.single_tx_min_usd * 0.5:
                            # 过小的直接 skip 省内存
                            continue
                    except (KeyError, ValueError, TypeError):
                        continue

                    bucket = agg.setdefault(label, {"total_usd": 0, "txs": [], "max_single_usd": 0})
                    bucket["total_usd"] += value_usd
                    bucket["max_single_usd"] = max(bucket["max_single_usd"], value_usd)
                    if len(bucket["txs"]) < 5:
                        # 记前 5 笔大额做证据，不存全部
                        bucket["txs"].append({
                            "hash":      tx["hash"],
                            "value_usd": round(value_usd, 2),
                            "ts":        ts,
                            "token":     token_sym,
                            "from":      tx["from"],
                        })

        signals = []
        for label, bucket in agg.items():
            # 触发条件：单笔 ≥ 阈值 OR 累计 ≥ 累计阈值
            single_hit = bucket["max_single_usd"] >= self.single_tx_min_usd
            cumulative_hit = bucket["total_usd"] >= self.cumulative_min_usd
            if not (single_hit or cumulative_hit):
                continue

            # 排前 5 笔按金额降序，便于飞书展示
            bucket["txs"].sort(key=lambda t: -t["value_usd"])
            latest_ts_ms = (max(t["ts"] for t in bucket["txs"]) * 1000) if bucket["txs"] else int(now_ts * 1000)

            signals.append(Signal(
                inst_id=f"WHALE-INFLOW-{label.upper()}",
                direction="dump",                         # 大额转入 CEX = 卖出预备
                chg_pct=round(bucket["total_usd"] / 1e6, 2),  # M USD 数量作为"幅度"
                vol_usdt=round(bucket["total_usd"], 0),
                bars=len(bucket["txs"]),
                open_price=0,
                close_price=0,
                bar_ts_ms=latest_ts_ms,
                source=self.name,
                meta={
                    "exchange":        label,
                    "total_usd":       round(bucket["total_usd"], 2),
                    "max_single_usd":  round(bucket["max_single_usd"], 2),
                    "tx_count":        len(bucket["txs"]),
                    "window_min":      self.window_min,
                    "trigger":         "single" if single_hit else "cumulative",
                    "top_txs":         bucket["txs"],
                },
            ))

        return signals

    def _fetch_recent_inflow(self, cex_addr: str, token_contract: str, offset: int = 100):
        r = requests.get(
            ETHERSCAN_V2,
            params={
                "chainid": "1",
                "module":  "account",
                "action":  "tokentx",
                "contractaddress": token_contract,
                "address": cex_addr,
                "page":    "1",
                "offset":  str(offset),
                "sort":    "desc",
                "apikey":  self.api_key,
            },
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("status") != "1":
            # No txs in range / NOTOK
            return []
        return data.get("result", [])
