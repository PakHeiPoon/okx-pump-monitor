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


def fetch_funding_rates_all():
    """全量永续合约当前资金费率。返回 {inst_id: funding_rate_float}。"""
    # OKX 不支持 batch funding-rate，但 instType=SWAP 的 tickers 也不带 funding，
    # 需要逐 inst 拉 funding-rate。为减少调用，先用 batch 拉 instruments，再按需查。
    # 这里返回原始端点：fetch_funding_rate(inst_id)，由调用方循环。
    raise NotImplementedError("Use fetch_funding_rate(inst_id) per symbol.")


def fetch_funding_rate(inst_id: str):
    """单合约当前资金费率。"""
    r = requests.get(
        f"{OKX_BASE}/api/v5/public/funding-rate",
        params={"instId": inst_id},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json().get("data", [])
    if not data:
        return None
    row = data[0]
    return {
        "inst_id": row.get("instId"),
        "funding_rate": float(row.get("fundingRate") or 0),
        "next_funding_rate": float(row.get("nextFundingRate") or 0),
        "next_funding_time_ms": int(row.get("nextFundingTime") or 0),
    }


def fetch_last_price(inst_id: str):
    """最新成交价（用于 breakout / price_alert）。"""
    r = requests.get(
        f"{OKX_BASE}/api/v5/market/ticker",
        params={"instId": inst_id},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json().get("data", [])
    if not data:
        return None
    return float(data[0].get("last") or 0)
