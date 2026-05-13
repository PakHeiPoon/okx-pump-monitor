"""Replay engine: 给定一批历史 signals，pull each signal's "future K线"
（detected_at 之后 N 分钟），算每条信号的真实后表现。

实现路径：
1. Supabase REST 拉 signals（按 since / monitor 过滤）
2. 对每条 signal：以 detected_at 为锚点，pull OKX 1m K线（覆盖 detected_at
   到 detected_at + horizon_min 之间的窗口）
3. 计算 entry / exit / chg_pct / 后表现是否符合 direction
4. 返回 BacktestResult dataclass，CLI 层做汇总+CSV
"""
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import requests

OKX_BASE = "https://www.okx.com"


@dataclass
class BacktestRow:
    signal_id: int
    inst_id: str
    source: str
    direction: str
    chg_pct_at_signal: float          # signal 触发时 monitor 自己算的 chg%
    detected_at: str                  # ISO
    entry_price: float                # signal 之后第一根 1m K 线 open
    exit_price: float                 # detected_at + horizon_min 那根 close
    horizon_return_pct: float         # (exit - entry) / entry * 100
    horizon_min: int
    is_correct: bool                  # direction 与实际后表现是否一致
    confidence_score: int = 1
    fused_sources: List[str] = field(default_factory=list)


def fetch_signals_since(since_iso: str, source: Optional[str] = None, limit: int = 5000) -> list:
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not key:
        raise SystemExit("[backtest] SUPABASE_URL / SUPABASE_SERVICE_KEY required")

    params = {
        "select": "*",
        "detected_at": f"gte.{since_iso}",
        "order": "detected_at.asc",
        "limit": str(limit),
    }
    if source and source != "all":
        params["source"] = f"eq.{source}"
    r = requests.get(
        f"{url}/rest/v1/signals",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        params=params,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def fetch_okx_candles_window(inst_id: str, anchor_ts_ms: int, horizon_min: int) -> list:
    """拉 anchor_ts ~ anchor_ts + horizon_min 范围内的 1m K线。

    OKX API `before` 是较老时间，`after` 是较新时间——其实是基于游标分页，
    用 history-candles 端点更稳妥（覆盖更长历史）。
    """
    # OKX history-candles 不需要 SWAP 后缀，复用现有 inst_id
    after_ms = anchor_ts_ms + horizon_min * 60 * 1000
    r = requests.get(
        f"{OKX_BASE}/api/v5/market/history-candles",
        params={
            "instId": inst_id,
            "bar":    "1m",
            "before": str(anchor_ts_ms - 60 * 1000),     # 拿到 anchor 之后那一根
            "after":  str(after_ms + 60 * 1000),
            "limit":  str(horizon_min + 2),
        },
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("data", []) or []


def _direction_correct(direction: str, ret_pct: float) -> bool:
    """signal 方向是否对：pump/above → 后表现正；dump/below → 后表现负。"""
    if direction in ("pump", "above"):
        return ret_pct > 0
    if direction in ("dump", "below"):
        return ret_pct < 0
    return False  # unknown direction


def replay_one(signal: dict, horizon_min: int) -> Optional[BacktestRow]:
    inst_id = signal["inst_id"]
    direction = signal["direction"]
    detected_at = signal["detected_at"]
    anchor_dt = datetime.fromisoformat(detected_at.replace("Z", "+00:00"))
    anchor_ms = int(anchor_dt.timestamp() * 1000)

    try:
        candles = fetch_okx_candles_window(inst_id, anchor_ms, horizon_min)
    except Exception as e:
        print(f"  [replay] {inst_id} fetch failed: {e}", file=sys.stderr)
        return None
    time.sleep(0.05)

    if len(candles) < 2:
        return None

    # OKX 返回最新在前，需要按 ts 正序，并过滤 confirmed
    candles_sorted = sorted(
        (c for c in candles if len(c) > 8 and c[8] == "1"),
        key=lambda c: int(c[0])
    )
    # 取 anchor_ms 之后的第一根作为 entry
    post = [c for c in candles_sorted if int(c[0]) >= anchor_ms]
    if len(post) < 2:
        return None

    entry_row = post[0]
    exit_row = post[-1]
    entry = float(entry_row[1])
    exit_p = float(exit_row[4])
    if entry <= 0:
        return None
    ret_pct = (exit_p - entry) / entry * 100

    meta = signal.get("meta") or {}
    return BacktestRow(
        signal_id=int(signal["id"]),
        inst_id=inst_id,
        source=signal["source"],
        direction=direction,
        chg_pct_at_signal=float(signal.get("chg_pct") or 0),
        detected_at=detected_at,
        entry_price=entry,
        exit_price=exit_p,
        horizon_return_pct=round(ret_pct, 4),
        horizon_min=horizon_min,
        is_correct=_direction_correct(direction, ret_pct),
        confidence_score=int(meta.get("confidence_score", 1)),
        fused_sources=meta.get("fused_sources", []) if isinstance(meta.get("fused_sources"), list) else [],
    )


def replay_all(signals: list, horizon_min: int = 15) -> List[BacktestRow]:
    rows = []
    for s in signals:
        row = replay_one(s, horizon_min)
        if row:
            rows.append(row)
    return rows


def to_dict(row: BacktestRow) -> dict:
    return asdict(row)
