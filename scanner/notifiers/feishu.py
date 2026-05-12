"""飞书机器人卡片通知。按 source 分组渲染，不同 monitor 显示不同 context。"""
from datetime import datetime, timezone, timedelta

import requests

from .base import Notifier
from ..okx import display_name

CST = timezone(timedelta(hours=8))


SOURCE_META = {
    "swap_top_gainers": {"label": "TOP50 异动",  "emoji": "🚀", "title": "15分钟拉升/闪崩"},
    "watchlist":        {"label": "自选盯盘",    "emoji": "🎯", "title": "Watchlist 异动"},
    "volume_surge":     {"label": "放量",        "emoji": "📊", "title": "成交量突变"},
    "funding_extreme":  {"label": "资金费率",    "emoji": "💰", "title": "Funding 极端"},
    "breakout":         {"label": "突破价位",    "emoji": "⚡", "title": "Breakout"},
    "price_alert":      {"label": "目标价/止损价", "emoji": "🔔", "title": "Price Alert"},
}


def _fmt_line(s):
    """根据 source 输出一行更有信息量的描述。"""
    sym = display_name(s.inst_id)
    bar_t = datetime.fromtimestamp(s.bar_ts_ms / 1000, CST).strftime("%H:%M")
    src = s.source
    if src in ("swap_top_gainers", "watchlist"):
        sign = "+" if s.chg_pct >= 0 else ""
        return f"  **{sym}**  {sign}{s.chg_pct}%  @{bar_t}  vol={s.vol_usdt:,.0f} U"
    if src == "volume_surge":
        mult = s.meta.get("vol_multiplier", "?")
        sign = "+" if s.chg_pct >= 0 else ""
        return f"  **{sym}**  vol×{mult}  价稳 {sign}{s.chg_pct}%  vol={s.vol_usdt:,.0f} U"
    if src == "funding_extreme":
        rate = s.meta.get("funding_rate_pct", s.chg_pct)
        sign = "+" if rate >= 0 else ""
        bias = "多头拥挤" if rate >= 0 else "空头拥挤"
        return f"  **{sym}**  funding {sign}{rate}%  ({bias})  价={s.close_price:g}"
    if src == "breakout":
        lvl = s.meta.get("level_price", s.open_price)
        label = s.meta.get("label") or ""
        dir_word = "上穿" if s.direction == "above" else "下穿"
        return f"  **{sym}**  {dir_word} {lvl:g}  当前 {s.close_price:g}  {label}".rstrip()
    if src == "price_alert":
        tgt = s.meta.get("target_price", s.open_price)
        atype = s.meta.get("alert_type", "")
        note = s.meta.get("note") or ""
        return f"  **{sym}**  到达 {tgt:g}（{atype}）  当前 {s.close_price:g}  {note}".rstrip()
    # fallback
    sign = "+" if s.chg_pct >= 0 else ""
    return f"  **{sym}**  {sign}{s.chg_pct}  @{bar_t}"


class FeishuNotifier(Notifier):
    name = "feishu"

    def __init__(self, webhook_url):
        self.webhook_url = webhook_url

    def send(self, signals):
        if not signals:
            return
        # 按 source 分组
        groups = {}
        for s in signals:
            groups.setdefault(s.source, []).append(s)

        now_str = datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")
        lines = [f"**OKX 异动提醒** ({now_str} CST)"]
        for src, sigs in groups.items():
            meta = SOURCE_META.get(src, {"emoji": "•", "label": src})
            lines.append("")
            lines.append(f"**{meta['emoji']} {meta['label']} · {len(sigs)} 个**")
            for s in sigs:
                lines.append(_fmt_line(s))
        content = "\n".join(lines)

        # 标题选取规则：单一来源 → 该来源 title；多来源 → "综合异动"
        if len(groups) == 1:
            src = next(iter(groups))
            meta = SOURCE_META.get(src, {"emoji": "🔥", "title": src})
            color = _color_for(src, groups[src])
            title = f"{meta['emoji']} {meta['title']} · {len(signals)} 个"
        else:
            color = "purple"
            title = f"⚡ 综合异动 · {len(signals)} 个信号（{len(groups)} 个维度）"

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
                        "text": {"tag": "plain_text", "content": "查看 Dashboard"},
                        "type": "primary",
                        "url": "https://okx-pump-monitor.vercel.app/",
                    }]},
                ],
            },
        }
        try:
            r = requests.post(self.webhook_url, json=body, timeout=10)
            print(f"[feishu] {r.status_code} {r.text[:120]}")
        except Exception as e:
            print(f"[feishu] FAILED: {e}")


def _color_for(source, sigs):
    """按 source + direction 选飞书卡片头部颜色。"""
    if source in ("swap_top_gainers", "watchlist"):
        pumps = sum(1 for s in sigs if s.direction == "pump")
        dumps = len(sigs) - pumps
        if pumps and dumps:
            return "purple"
        return "red" if pumps else "blue"
    if source == "volume_surge":
        return "orange"
    if source == "funding_extreme":
        return "yellow"
    if source == "breakout":
        return "carmine"
    if source == "price_alert":
        return "turquoise"
    return "red"
