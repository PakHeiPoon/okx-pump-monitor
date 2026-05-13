"""飞书机器人卡片通知。按 source 分组渲染，不同 monitor 显示不同 context。"""
from datetime import datetime, timezone, timedelta

import requests

from .base import Notifier
from ..okx import display_name

CST = timezone(timedelta(hours=8))


SOURCE_META = {
    "swap_top_gainers": {"label": "TOP50 异动",     "emoji": "🚀", "title": "15分钟拉升/闪崩"},
    "watchlist":        {"label": "自选盯盘",       "emoji": "🎯", "title": "Watchlist 异动"},
    "volume_surge":     {"label": "放量",           "emoji": "📊", "title": "成交量突变"},
    "funding_extreme":  {"label": "资金费率",       "emoji": "💰", "title": "Funding 极端"},
    "breakout":         {"label": "突破价位",       "emoji": "⚡", "title": "Breakout"},
    "price_alert":      {"label": "目标价/止损价",  "emoji": "🔔", "title": "Price Alert"},
    "oi_surge":         {"label": "持仓量异动",     "emoji": "📈", "title": "OI Surge"},
    "perp_premium":     {"label": "合约-现货价差",  "emoji": "💱", "title": "Perp Premium"},
    "new_listings":     {"label": "新上架合约",     "emoji": "🆕", "title": "New Listing"},
    "longshort_ratio":  {"label": "散户多空比极端", "emoji": "⚖️", "title": "Long/Short Ratio"},
    "liquidations":     {"label": "强平爆仓密集",   "emoji": "💀", "title": "Liquidations"},
    "cross_exchange":   {"label": "跨所价差",       "emoji": "🔀", "title": "Cross-Exchange Spread"},
    "flush_reversal":   {"label": "闪崩 V 反弹",    "emoji": "🪂", "title": "Flush Reversal"},
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
    if src == "oi_surge":
        delta = s.meta.get("delta_pct", s.chg_pct)
        oi_usd = s.meta.get("current_oi_usd") or 0
        sign = "+" if delta >= 0 else ""
        usd_str = f"${oi_usd / 1e6:.1f}M" if oi_usd >= 1e6 else f"${oi_usd:,.0f}"
        return f"  **{sym}**  OI {sign}{delta}%  总持仓={usd_str}"
    if src == "perp_premium":
        prem = s.meta.get("premium_pct", s.chg_pct)
        sign = "+" if prem >= 0 else ""
        bias = "合约溢价(多头狂热)" if prem > 0 else "合约折价(空头狂热)"
        return f"  **{sym}**  premium {sign}{prem}%  {bias}"
    if src == "new_listings":
        last = s.meta.get("last_price") or s.close_price or 0
        return f"  **{sym}**  🆕 NEW  当前价 {last:g}"
    if src == "longshort_ratio":
        ratio = s.meta.get("ratio", s.chg_pct)
        bias = s.meta.get("bias", "")
        return f"  **{sym}**  L/S {ratio}  ({bias})"
    if src == "liquidations":
        long_usd = s.meta.get("long_liq_usd", 0)
        short_usd = s.meta.get("short_liq_usd", 0)
        win = s.meta.get("window_min", 5)
        cnt = s.meta.get("event_count", 0)
        side = "多头爆仓" if long_usd > short_usd else "空头爆仓"
        return (f"  **{sym}**  💀 {win}min {cnt} 笔强平  "
                f"long ${long_usd / 1e6:.2f}M / short ${short_usd / 1e6:.2f}M  ({side})")
    if src == "cross_exchange":
        max_ex = s.meta.get("max_exchange", "?")
        min_ex = s.meta.get("min_exchange", "?")
        spread = s.meta.get("spread_pct", s.chg_pct)
        okx_p = s.meta.get("okx_price")
        return (f"  **{sym}**  🔀 spread {spread}%  "
                f"{max_ex}={s.close_price:g} > {min_ex}={s.open_price:g}  "
                f"(OKX={okx_p:g})")
    if src == "flush_reversal":
        peak = s.meta.get("peak_price", 0)
        trough = s.meta.get("trough_price", s.open_price)
        drop = s.meta.get("drop_pct", 0)
        rec = s.meta.get("recovery_pct", s.chg_pct)
        pt = s.meta.get("peak_trough_min", "?")
        post = s.meta.get("post_trough_min", "?")
        vol_x = s.meta.get("vol_multiplier", "?")
        return (f"  **{sym}**  🪂 闪崩反弹  peak {peak:g} → trough {trough:g}（-{drop}% in {pt}min）\n"
                f"    反弹 {rec}%（现 {s.close_price:g}，距底 {post}min）· vol×{vol_x}")
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

        # V2.9: fusion-aware rendering — 优先把同 inst_id 多 source 信号折叠
        # 成一行高置信卡片，剩下的按 source 分组保留兼容旧逻辑。
        high_conf_lines = []
        seen_groups = set()
        for s in signals:
            conf = s.meta.get("confidence_score", 1) if isinstance(s.meta, dict) else 1
            gid = s.meta.get("fusion_group_id") if isinstance(s.meta, dict) else None
            is_primary = s.meta.get("fusion_primary", True) if isinstance(s.meta, dict) else True
            if conf >= 2 and gid and is_primary and gid not in seen_groups:
                seen_groups.add(gid)
                sources_chips = " ".join(
                    f"`{src}`" for src in s.meta.get("fused_sources", [s.source])
                )
                stars = "★" * conf + "☆" * (5 - conf)
                high_conf_lines.append(
                    f"  **{display_name(s.inst_id)}** {stars}  ({conf} 维度同时触发)\n"
                    f"    {sources_chips}\n"
                    f"    {_fmt_line(s).strip()}"
                )

        # 剩下的（confidence=1 或非 primary 在融合组里）按 source 分组渲染
        leftover = []
        for s in signals:
            gid = s.meta.get("fusion_group_id") if isinstance(s.meta, dict) else None
            if gid and gid in seen_groups:
                # 已在高置信卡片里被代表了，不重复渲染
                continue
            leftover.append(s)

        groups = {}
        for s in leftover:
            groups.setdefault(s.source, []).append(s)

        now_str = datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")
        lines = [f"**OKX 异动提醒** ({now_str} CST)"]
        if high_conf_lines:
            lines.append("")
            lines.append(f"**🔥 高置信信号（多维度共振）· {len(high_conf_lines)} 组**")
            lines.extend(high_conf_lines)
        for src, sigs in groups.items():
            meta = SOURCE_META.get(src, {"emoji": "•", "label": src})
            lines.append("")
            lines.append(f"**{meta['emoji']} {meta['label']} · {len(sigs)} 个**")
            for s in sigs:
                lines.append(_fmt_line(s))
        content = "\n".join(lines)

        # 标题选取规则（fusion 优先）：
        #   有高置信组 → "🔥 高置信共振 · N 组" + 红色
        #   单一来源 leftover → 该来源 title
        #   多来源 leftover → "综合异动"
        if high_conf_lines:
            color = "red"
            extra = f" + {len(leftover)} 单维度" if leftover else ""
            title = f"🔥 高置信共振 · {len(high_conf_lines)} 组{extra}"
        elif len(groups) == 1:
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
    if source == "oi_surge":
        return "indigo"
    if source == "perp_premium":
        return "wathet"
    if source == "new_listings":
        return "green"
    if source == "longshort_ratio":
        return "violet"
    if source == "liquidations":
        # 多头爆仓主导=红（dump），空头爆仓主导=蓝（pump）
        return "red" if sigs[0].direction == "dump" else "blue"
    if source == "cross_exchange":
        return "purple"
    if source == "flush_reversal":
        return "carmine"  # 显眼但和 breakout 区分
    return "red"
