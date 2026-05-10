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
THRESHOLD = float(os.environ.get("THRESHOLD", "2.0"))   # 百分比
MIN_VOL_USDT = float(os.environ.get("MIN_VOL_USDT", "5000"))
LOOKBACK_BARS = int(os.environ.get("LOOKBACK_BARS", "5"))  # 检查最近N根1m K线

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


def check_pump(inst_id):
    """检查最近若干根已收盘的1m K线，找出超阈值的"""
    candles = fetch_1m_candles(inst_id)
    hits = []
    for row in candles:
        # [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
        ts = int(row[0])
        o = float(row[1]); c = float(row[4])
        vol_quote = float(row[7]) if len(row) > 7 else 0
        confirm = row[8] == "1"
        if not confirm or o <= 0:
            continue
        chg_pct = (c - o) / o * 100
        if chg_pct >= THRESHOLD and vol_quote >= MIN_VOL_USDT:
            hits.append({
                "ts": ts, "open": o, "close": c,
                "chg_pct": round(chg_pct, 2),
                "vol_usdt": round(vol_quote, 0),
            })
    return hits


def send_feishu(signals):
    if not signals:
        return
    # 用一条消息打包多个信号，避免刷屏
    lines = [f"**🚀 OKX 1分钟涨幅提醒** ({now_cst()} CST)\n"]
    for s in signals:
        bar_time = datetime.fromtimestamp(s["ts"]/1000, CST).strftime("%H:%M")
        lines.append(
            f"**{s['inst']}**  +{s['chg_pct']}%  "
            f"@{bar_time}  vol={s['vol_usdt']:,.0f} U"
        )
    content = "\n".join(lines)

    body = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": "red",
                "title": {"tag": "plain_text",
                          "content": f"🔥 发现 {len(signals)} 个pump信号"},
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
            hits = check_pump(inst)
        except Exception as e:
            print(f"  {inst} 拉K线失败: {e}")
            continue
        if not hits:
            continue
        if inst in state:
            continue   # 冷却中
        # 取最强的一根
        best = max(hits, key=lambda x: x["chg_pct"])
        best["inst"] = inst
        all_signals.append(best)
        state[inst] = now
        print(f"  ✓ {inst} +{best['chg_pct']}% vol={best['vol_usdt']:.0f}U")
        time.sleep(0.1)   # 避免太快被限流

    if all_signals:
        # 按涨幅排序
        all_signals.sort(key=lambda x: x["chg_pct"], reverse=True)
        send_feishu(all_signals)
    else:
        print("本轮无信号")

    save_state(state)


if __name__ == "__main__":
    main()
