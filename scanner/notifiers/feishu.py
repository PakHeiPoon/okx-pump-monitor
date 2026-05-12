"""飞书机器人卡片通知。从原 scan.py send_feishu 抽过来。"""
from datetime import datetime, timezone, timedelta

import requests

from .base import Notifier
from ..okx import display_name

CST = timezone(timedelta(hours=8))


class FeishuNotifier(Notifier):
    name = "feishu"

    def __init__(self, webhook_url):
        self.webhook_url = webhook_url

    def send(self, signals):
        if not signals:
            return
        pumps = [s for s in signals if s.direction == "pump"]
        dumps = [s for s in signals if s.direction == "dump"]

        now_str = datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S")
        lines = [f"**OKX 合约 15分钟异动提醒** ({now_str} CST)\n"]
        if pumps:
            lines.append(f"**🚀 拉升 {len(pumps)} 个**")
            for s in pumps:
                t = datetime.fromtimestamp(s.bar_ts_ms / 1000, CST).strftime("%H:%M")
                lines.append(
                    f"  **{display_name(s.inst_id)}**  +{s.chg_pct}%  "
                    f"@{t}  vol={s.vol_usdt:,.0f} U"
                )
        if dumps:
            if pumps:
                lines.append("")
            lines.append(f"**📉 闪崩 {len(dumps)} 个**")
            for s in dumps:
                t = datetime.fromtimestamp(s.bar_ts_ms / 1000, CST).strftime("%H:%M")
                lines.append(
                    f"  **{display_name(s.inst_id)}**  {s.chg_pct}%  "
                    f"@{t}  vol={s.vol_usdt:,.0f} U"
                )
        content = "\n".join(lines)

        if pumps and dumps:
            color, title = "purple", f"⚡ 拉升 {len(pumps)} / 闪崩 {len(dumps)}"
        elif pumps:
            color, title = "red", f"🔥 发现 {len(pumps)} 个拉升信号"
        else:
            color, title = "blue", f"❄️ 发现 {len(dumps)} 个闪崩信号"

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
                        "text": {"tag": "plain_text", "content": "查看 OKX 合约涨幅榜"},
                        "type": "primary",
                        "url": "https://www.okx.com/zh-hans/markets/prices?tab=derivatives",
                    }]},
                ],
            },
        }
        try:
            r = requests.post(self.webhook_url, json=body, timeout=10)
            print(f"[feishu] {r.status_code} {r.text[:120]}")
        except Exception as e:
            print(f"[feishu] FAILED: {e}")
