"""OKX 公共行情 API 封装。无 auth，无代理，GitHub Runner 直连。"""
import requests

OKX_BASE = "https://www.okx.com"


def _fetch_swap_tickers_raw():
    r = requests.get(
        f"{OKX_BASE}/api/v5/market/tickers",
        params={"instType": "SWAP"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["data"]


def _parse_pairs(tickers):
    """tickers raw → list[dict(inst_id, chg, last, vol)]，已过滤到 -USDT-SWAP。"""
    out = []
    for t in tickers:
        inst = t.get("instId", "")
        if not inst.endswith("-USDT-SWAP"):
            continue
        last = float(t.get("last") or 0)
        open24h = float(t.get("open24h") or 0)
        if open24h <= 0:
            continue
        chg = (last - open24h) / open24h
        vol = float(t.get("volCcy24h") or 0)
        out.append({"inst_id": inst, "chg": chg, "last": last, "vol": vol})
    return out


def fetch_top_swap_gainers(top_n: int):
    """24h 涨幅 TOP N（按 chg 降序）。保留给 funding / longshort 这类
    rubik API 慢、只看主流币的 monitor 用。"""
    pairs = _parse_pairs(_fetch_swap_tickers_raw())
    pairs.sort(key=lambda p: -p["chg"])
    return [(p["inst_id"], p["chg"], p["last"]) for p in pairs[:top_n]]


def fetch_active_universe(top_movers: int = 50, top_volume: int = 100):
    """主扫描 universe = |24h chg| 排 TOP M ∪ 24h vol 排 TOP V，去重。
    覆盖两类活跃币：异动型 + 高成交量型（LAB 这种 24h 横盘但量大的也能进）。
    返回 list[(inst_id, chg_ratio, last)] 按 abs chg 降序。"""
    pairs = _parse_pairs(_fetch_swap_tickers_raw())
    by_chg = sorted(pairs, key=lambda p: -abs(p["chg"]))[:top_movers]
    by_vol = sorted(pairs, key=lambda p: -p["vol"])[:top_volume]
    seen = {}
    for p in by_chg + by_vol:
        seen[p["inst_id"]] = p
    merged = sorted(seen.values(), key=lambda p: -abs(p["chg"]))
    return [(p["inst_id"], p["chg"], p["last"]) for p in merged]


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


def fetch_spot_last_price(symbol_pair: str):
    """SPOT 现货最新价。symbol_pair 形如 'BTC-USDT'"""
    r = requests.get(
        f"{OKX_BASE}/api/v5/market/ticker",
        params={"instId": symbol_pair},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json().get("data", [])
    if not data:
        return None
    return float(data[0].get("last") or 0)


def fetch_all_swap_inst_ids():
    """全部 live 状态的 SWAP USDT-本位永续 instId 集合。"""
    r = requests.get(
        f"{OKX_BASE}/api/v5/public/instruments",
        params={"instType": "SWAP"},
        timeout=15,
    )
    r.raise_for_status()
    rows = r.json().get("data", [])
    out = set()
    for row in rows:
        if row.get("state") == "live" and row.get("instId", "").endswith("-USDT-SWAP"):
            out.add(row["instId"])
    return out


def fetch_long_short_account_ratio(inst_id: str, period: str = "5m"):
    """OKX rubik 数据 - 散户多空账户比。inst_id 用 base，如 'BTC'。"""
    base = inst_id.replace("-USDT-SWAP", "").replace("-USDT", "")
    r = requests.get(
        f"{OKX_BASE}/api/v5/rubik/stat/contracts/long-short-account-ratio",
        params={"ccy": base, "period": period, "limit": "1"},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json().get("data", [])
    if not data:
        return None
    # data row = [ts, ratio]
    row = data[0]
    return {"ts_ms": int(row[0]), "ratio": float(row[1])}


def fetch_swap_instruments():
    """全部 USDT-本位 SWAP 合约的 lot size / ctVal / 状态。

    返回 dict {inst_id: {"ct_val": float, "ct_val_ccy": str, "uly": str}}。
    清算 monitor 用 ct_val 把"合约张数"换算成"base 币数量"，再乘以价格得 USD。
    """
    r = requests.get(
        f"{OKX_BASE}/api/v5/public/instruments",
        params={"instType": "SWAP"},
        timeout=15,
    )
    r.raise_for_status()
    rows = r.json().get("data", [])
    out = {}
    for row in rows:
        if row.get("state") != "live":
            continue
        inst = row.get("instId", "")
        if not inst.endswith("-USDT-SWAP"):
            continue
        out[inst] = {
            "ct_val":      float(row.get("ctVal") or 0),
            "ct_val_ccy":  row.get("ctValCcy") or "",
            "uly":         row.get("uly") or "",
        }
    return out


def fetch_liquidation_orders(uly: str, limit: int = 100):
    """单 underlying 的最近强平订单。返回 list[dict]，每行：
       {inst_id, pos_side ('long'/'short'), sz, bk_px, ts_ms}

    posSide=long  → 多头被强平（抛压）
    posSide=short → 空头被强平（轧空）
    sz 是合约张数，需要 ct_val 换算实际 base 币量。
    """
    r = requests.get(
        f"{OKX_BASE}/api/v5/public/liquidation-orders",
        params={
            "instType": "SWAP",
            "state":    "filled",
            "uly":      uly,
            "limit":    str(limit),
        },
        timeout=10,
    )
    r.raise_for_status()
    blocks = r.json().get("data", [])
    out = []
    for blk in blocks:
        inst = blk.get("instId", "")
        for d in blk.get("details", []):
            out.append({
                "inst_id":  inst,
                "pos_side": d.get("posSide", ""),
                "sz":       float(d.get("sz") or 0),
                "bk_px":    float(d.get("bkPx") or 0),
                "ts_ms":    int(d.get("ts") or d.get("time") or 0),
            })
    return out


def fetch_all_open_interest():
    """全部 SWAP 当前 OI 快照。返回 list[dict]，过滤到 -USDT-SWAP 为主。

    每个 dict 含: inst_id, oi (contracts), oi_ccy (in base coin), oi_usd, ts_ms。
    """
    r = requests.get(
        f"{OKX_BASE}/api/v5/public/open-interest",
        params={"instType": "SWAP"},
        timeout=15,
    )
    r.raise_for_status()
    rows = r.json().get("data", [])
    out = []
    for row in rows:
        inst = row.get("instId", "")
        if not inst.endswith("-USDT-SWAP"):
            continue
        out.append({
            "inst_id": inst,
            "oi": float(row.get("oi") or 0),
            "oi_ccy": float(row.get("oiCcy") or 0),
            "oi_usd": float(row.get("oiUsd") or 0),
            "ts_ms": int(row.get("ts") or 0),
        })
    return out
