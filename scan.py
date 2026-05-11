"""
OKX 涨幅榜扫描器（GitHub Actions 版）
- 拉取24h涨幅榜
- 对TOP N每个币拉最近的1m K线
- 涨幅超阈值的发飞书

无需代理，GitHub Runner 直连OKX。
"""

import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta

import requests

# ============== 配置 ==============
TOP_N = int(os.environ.get("TOP_N", "100"))
# 兼容老 THRESHOLD：如果只设了 THRESHOLD，两个方向都用它
_LEGACY_THRESHOLD = float(os.environ.get("THRESHOLD", "5.0"))
PUMP_THRESHOLD = float(os.environ.get("PUMP_THRESHOLD", _LEGACY_THRESHOLD))   # 拉升触发阈值 %
DUMP_THRESHOLD = float(os.environ.get("DUMP_THRESHOLD", _LEGACY_THRESHOLD))   # 闪崩触发阈值 %（绝对值）
MIN_VOL_USDT = float(os.environ.get("MIN_VOL_USDT", "5000"))
LOOKBACK_BARS = int(os.environ.get("LOOKBACK_BARS", "16"))  # 拉取根数，过滤未收盘后约 15 根 = 15 分钟窗口

FEISHU_WEBHOOK = os.environ["FEISHU_WEBHOOK"]
STATE_FILE = "state.json"   # 记录已提醒，跨runs去重
COOLDOWN_MIN = 30           # 同币30分钟内不重复提醒

OKX_BASE = "https://www.okx.com"
CST = timezone(timedelta(hours=8))


def now_cst():
    return datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def fetch_top_gainers():
    r = requests.get(f"{OKX_BASE}/api/v5/market/tickers",
                     params={"instType": "SPOT"}, timeout=15)
    r.raise_for_status()
    data = r.json()["data"]
    pairs = []
    for t in data:
        inst = t["instId"]
        if not inst.endswith("-USDT"):
            continue
        last = float(t["last"] or 0)
        open24h = float(t["open24h"] or 0)
        if open24h <= 0:
            continue
        chg = (last - open24h) / open24h
        pairs.append((inst, chg, last))
    pairs.sort(key=lambda x: x[1], reverse=True)
    return pairs[:TOP_N]


def fetch_1m_candles(inst_id, limit=LOOKBACK_BARS):
    """OKX返回顺序：最新在前"""
    r = requests.get(f"{OKX_BASE}/api/v5/market/candles",
                     params={"instId": inst_id, "bar": "1m", "limit": limit},
                     timeout=10)
    r.raise_for_status()
    return r.json().get("data", [])


def check_signal(inst_id):
    """滑动窗口：取最近 LOOKBACK_BARS 根已收盘 1m K线，
    用最早 open 到最新 close 的累计涨跌幅判断 pump / dump。
    返回至多 1 条命中记录（含 direction 字段）。"""
    candles = fetch_1m_candles(inst_id)
    # OKX 顺序：最新在前。先按 confirm 过滤
    confirmed = [row for row in candles if len(row) > 8 and row[8] == "1"]
    if len(confirmed) < 2:
        return []
    latest = confirmed[0]
    earliest = confirmed[-1]
    open_price = float(earliest[1])
    close_price = float(latest[4])
    if open_price <= 0:
        return []
    chg_pct = (close_price - open_price) / open_price * 100
    total_vol = sum(float(r[7]) if len(r) > 7 else 0 for r in confirmed)
    if total_vol < MIN_VOL_USDT:
        return []
    if chg_pct >= PUMP_THRESHOLD:
        direction = "pump"
    elif chg_pct <= -DUMP_THRESHOLD:
        direction = "dump"
    else:
        return []
    return [{
        "ts": int(latest[0]),
        "open": open_price,
        "close": close_price,
        "chg_pct": round(chg_pct, 2),
        "vol_usdt": round(total_vol, 0),
        "bars": len(confirmed),
        "direction": direction,
    }]


def send_feishu(signals):
    if not signals:
        return
    pumps = [s for s in signals if s["direction"] == "pump"]
    dumps = [s for s in signals if s["direction"] == "dump"]

    lines = [f"**OKX 15分钟异动提醒** ({now_cst()} CST)\n"]
    if pumps:
        lines.append(f"**🚀 拉升 {len(pumps)} 个**")
        for s in pumps:
            bar_time = datetime.fromtimestamp(s["ts"]/1000, CST).strftime("%H:%M")
            lines.append(
                f"  **{s['inst']}**  +{s['chg_pct']}%  "
                f"@{bar_time}  vol={s['vol_usdt']:,.0f} U"
            )
    if dumps:
        if pumps:
            lines.append("")
        lines.append(f"**📉 闪崩 {len(dumps)} 个**")
        for s in dumps:
            bar_time = datetime.fromtimestamp(s["ts"]/1000, CST).strftime("%H:%M")
            lines.append(
                f"  **{s['inst']}**  {s['chg_pct']}%  "
                f"@{bar_time}  vol={s['vol_usdt']:,.0f} U"
            )
    content = "\n".join(lines)

    # 配色：纯涨红、纯崩蓝、双向紫
    if pumps and dumps:
        color = "purple"
        title = f"⚡ 拉升 {len(pumps)} / 闪崩 {len(dumps)}"
    elif pumps:
        color = "red"
        title = f"🔥 发现 {len(pumps)} 个拉升信号"
    else:
        color = "blue"
        title = f"❄️ 发现 {len(dumps)} 个闪崩信号"

    body = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": color,
                "title": {"tag": "plain_text", "content": title},
            },
            "elements": [
                {"tag": "markdown", "content": content},
                {"tag": "action", "actions": [{
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "查看 OKX 涨幅榜"},
                    "type": "primary",
                    "url": "https://www.okx.com/zh-hans/markets/prices",
                }]},
            ],
        }
    }
    r = requests.post(FEISHU_WEBHOOK, json=body, timeout=10)
    print(f"飞书推送: {r.status_code} {r.text[:200]}")


def main():
    state = load_state()
    now = time.time()

    # 清理冷却期外的旧记录
    state = {k: v for k, v in state.items() if now - v < COOLDOWN_MIN * 60}

    print(f"[{now_cst()}] 拉取涨幅榜 TOP {TOP_N}")
    top = fetch_top_gainers()
    print(f"前5: {[(p[0], f'{p[1]*100:.1f}%') for p in top[:5]]}")

    all_signals = []
    for inst, chg24h, last in top:
        # 24h涨幅都不到5%的币，1m不太可能有大动作，跳过加速扫描
        # 想全扫的话注释掉这行
        if chg24h * 100 < 3:
            continue
        try:
            hits = check_signal(inst)
        except Exception as e:
            print(f"  {inst} 拉K线失败: {e}")
            continue
        if not hits:
            continue
        if inst in state:
            continue   # 冷却中
        # 取绝对涨跌幅最强的一根
        best = max(hits, key=lambda x: abs(x["chg_pct"]))
        best["inst"] = inst
        all_signals.append(best)
        state[inst] = now
        arrow = "+" if best["chg_pct"] >= 0 else ""
        print(f"  ✓ {inst} [{best['direction']}] {arrow}{best['chg_pct']}% vol={best['vol_usdt']:.0f}U")
        time.sleep(0.1)   # 避免太快被限流

    if all_signals:
        # 按绝对涨跌幅排序（先拉升后闪崩）
        all_signals.sort(key=lambda x: (x["direction"] != "pump", -abs(x["chg_pct"])))
        send_feishu(all_signals)
    else:
        print("本轮无信号")

    save_state(state)


if __name__ == "__main__":
    main()
