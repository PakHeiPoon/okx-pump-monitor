"""OKX 公共行情 API 封装。无 auth，无代理，GitHub Runner 直连。"""
import requests

OKX_BASE = "https://www.okx.com"


def fetch_top_swap_gainers(top_n: int):
    """USDT 本位永续合约 24h 涨幅榜 TOP N。返回 [(inst_id, chg_ratio, last_price), ...]"""
    r = requests.get(
        f"{OKX_BASE}/api/v5/market/tickers",
        params={"instType": "SWAP"},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()["data"]
    pairs = []
    for t in data:
        inst = t["instId"]
        if not inst.endswith("-USDT-SWAP"):
            continue
        last = float(t["last"] or 0)
        open24h = float(t["open24h"] or 0)
        if open24h <= 0:
            continue
        chg = (last - open24h) / open24h
        pairs.append((inst, chg, last))
    pairs.sort(key=lambda x: x[1], reverse=True)
    return pairs[:top_n]


def fetch_1m_candles(inst_id: str, limit: int):
    """1m K 线（最新在前）。返回 OKX 原始 list[list]。"""
    r = requests.get(
        f"{OKX_BASE}/api/v5/market/candles",
        params={"instId": inst_id, "bar": "1m", "limit": limit},
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("data", [])


def display_name(inst_id: str) -> str:
    """BTC-USDT-SWAP → BTC-USDT"""
    return inst_id[:-5] if inst_id.endswith("-SWAP") else inst_id
