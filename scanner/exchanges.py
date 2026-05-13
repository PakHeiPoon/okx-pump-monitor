"""Multi-exchange price helpers — 跨所价差 monitor 用。

设计原则：单批 API call 把每家所有 USDT-perp 价格拉下来，避免循环。
中国大陆 + AWS US 都能访问（Binance / Bybit 被 geo-block，所以选 Bitget / Gate.io）。

返回 schema 统一为 {base_symbol: last_price_float}，base_symbol 是裸大写字母
（如 'BTC'），方便和 OKX 的 inst_id 'BTC-USDT-SWAP' 做匹配。
"""
import requests


def fetch_bitget_swap_prices():
    """返回 {base: last_price} dict。
    Bitget USDT-FUTURES symbol 形如 'BTCUSDT'，去掉 'USDT' 即 base。"""
    try:
        r = requests.get(
            "https://api.bitget.com/api/v2/mix/market/tickers",
            params={"productType": "USDT-FUTURES"},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json().get("data", [])
    except Exception as e:
        print(f"[bitget] fetch failed: {e}")
        return {}
    out = {}
    for row in data:
        sym = row.get("symbol", "")
        if not sym.endswith("USDT"):
            continue
        base = sym[:-4]
        last = row.get("lastPr") or "0"
        try:
            last_f = float(last)
        except (TypeError, ValueError):
            continue
        if last_f > 0:
            out[base] = last_f
    return out


def fetch_gateio_swap_prices():
    """返回 {base: last_price} dict。
    Gate.io contract 形如 'BTC_USDT'，'_USDT' 之前是 base。"""
    try:
        r = requests.get(
            "https://api.gateio.ws/api/v4/futures/usdt/tickers",
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"[gate] fetch failed: {e}")
        return []
    out = {}
    for row in data:
        ct = row.get("contract", "")
        if not ct.endswith("_USDT"):
            continue
        base = ct[:-5]
        last = row.get("last") or "0"
        try:
            last_f = float(last)
        except (TypeError, ValueError):
            continue
        if last_f > 0:
            out[base] = last_f
    return out


def okx_inst_to_base(inst_id: str) -> str:
    """'BTC-USDT-SWAP' → 'BTC'."""
    if inst_id.endswith("-USDT-SWAP"):
        return inst_id[:-10]
    return inst_id
