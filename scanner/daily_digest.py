"""V2.7 邮件每日汇总。

跟主 scanner.main 完全独立。由 GitHub Actions 每天一次 cron 调起。
拉 Supabase 过去 24h signals → 按 source 聚合 → 渲染 HTML → Resend 发邮件。

需要的 env:
- SUPABASE_URL / SUPABASE_SERVICE_KEY  (复用现有 secret)
- RESEND_API_KEY                       (你去 resend.com 注册后拿到)
- DIGEST_TO_EMAIL                      (收件人)
- DIGEST_FROM_EMAIL                    (发件人，必须是 Resend verified)

未配 RESEND_* env 时 graceful skip，不影响 GH Actions 绿。
"""
import os
import sys
from datetime import datetime, timezone, timedelta
from collections import defaultdict

import requests


CST = timezone(timedelta(hours=8))

SOURCE_LABELS = {
    "swap_top_gainers": ("🚀", "TOP50 15分钟拉升/闪崩"),
    "watchlist":        ("🎯", "Watchlist 自选盯盘"),
    "volume_surge":     ("📊", "成交量突变"),
    "funding_extreme":  ("💰", "资金费率极端"),
    "breakout":         ("⚡", "突破前高/前低"),
    "price_alert":      ("🔔", "目标价/止损价"),
    "oi_surge":         ("📈", "持仓量异动"),
    "perp_premium":     ("💱", "合约-现货价差"),
    "new_listings":     ("🆕", "新上架合约"),
    "longshort_ratio":  ("⚖️",  "散户多空比极端"),
}


def fetch_24h_signals():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("[daily_digest] missing supabase env, exiting")
        sys.exit(0)
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    r = requests.get(
        f"{url}/rest/v1/signals",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        params={
            "select": "*",
            "detected_at": f"gte.{since}",
            "order": "detected_at.desc",
            "limit": "1000",
        },
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def render_html(signals):
    by_src = defaultdict(list)
    for s in signals:
        by_src[s["source"]].append(s)

    now = datetime.now(CST).strftime("%Y-%m-%d %H:%M CST")
    rows_html = []
    for src, items in sorted(by_src.items(), key=lambda kv: -len(kv[1])):
        emoji, label = SOURCE_LABELS.get(src, ("•", src))
        rows_html.append(
            f'<tr><td style="padding:8px 12px;font-size:14px;color:#cbd5e1;">'
            f'{emoji} {label}</td>'
            f'<td style="padding:8px 12px;font-size:14px;color:#f8fafc;font-weight:600;text-align:right;">'
            f'{len(items)}</td></tr>'
        )

    top_lines = []
    for s in signals[:15]:
        emoji, _ = SOURCE_LABELS.get(s["source"], ("•", s["source"]))
        chg = float(s.get("chg_pct") or 0)
        sign = "+" if chg >= 0 else ""
        symbol = s.get("symbol") or s.get("inst_id", "?").replace("-USDT-SWAP", "")
        color = "#34d399" if chg >= 0 else "#f87171"
        ts = datetime.fromisoformat(s["detected_at"].replace("Z", "+00:00")).astimezone(CST)
        top_lines.append(
            f'<tr>'
            f'<td style="padding:6px 12px;font-family:ui-monospace,monospace;font-size:13px;color:#f1f5f9;">{symbol}</td>'
            f'<td style="padding:6px 12px;font-size:12px;color:#94a3b8;">{emoji}</td>'
            f'<td style="padding:6px 12px;font-family:ui-monospace,monospace;font-size:13px;color:{color};text-align:right;">{sign}{chg:.2f}%</td>'
            f'<td style="padding:6px 12px;font-size:12px;color:#64748b;text-align:right;">{ts.strftime("%H:%M")}</td>'
            f'</tr>'
        )

    return f"""\
<!doctype html>
<html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:12px;overflow:hidden;">
    <div style="padding:24px;border-bottom:1px solid #262626;">
      <h1 style="margin:0;color:#fafafa;font-size:20px;">⚡ OKX Pump Monitor · 24h 汇总</h1>
      <p style="margin:6px 0 0;color:#94a3b8;font-size:13px;">{now} · 共 {len(signals)} 个信号</p>
    </div>

    <div style="padding:20px 24px;">
      <h2 style="margin:0 0 12px;color:#e5e5e5;font-size:14px;font-weight:600;">📊 按维度分布</h2>
      <table style="width:100%;border-collapse:collapse;background:#0f0f0f;border-radius:8px;overflow:hidden;">
        {''.join(rows_html) if rows_html else '<tr><td style="padding:16px;color:#737373;text-align:center;">本日全市场平静</td></tr>'}
      </table>
    </div>

    <div style="padding:0 24px 24px;">
      <h2 style="margin:0 0 12px;color:#e5e5e5;font-size:14px;font-weight:600;">🔥 Top 15 最新信号</h2>
      <table style="width:100%;border-collapse:collapse;background:#0f0f0f;border-radius:8px;overflow:hidden;">
        {''.join(top_lines) if top_lines else '<tr><td style="padding:16px;color:#737373;text-align:center;">无</td></tr>'}
      </table>
    </div>

    <div style="padding:16px 24px;border-top:1px solid #262626;background:#0a0a0a;">
      <a href="https://okx-pump-monitor.vercel.app/" style="display:inline-block;background:#10b981;color:#0a0a0a;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:13px;font-weight:600;">查看 Dashboard →</a>
    </div>
  </div>
</body></html>"""


def send_via_resend(html, signal_count):
    api_key = os.environ.get("RESEND_API_KEY", "")
    to_email = os.environ.get("DIGEST_TO_EMAIL", "")
    from_email = os.environ.get("DIGEST_FROM_EMAIL", "")
    if not api_key or not to_email or not from_email:
        print("[daily_digest] RESEND_* env not fully configured, printing html instead")
        print(html[:500] + " ...")
        return
    now_cn = datetime.now(CST).strftime("%m-%d")
    r = requests.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "from": from_email,
            "to": [to_email],
            "subject": f"OKX Pump Monitor · {now_cn} · {signal_count} 个信号",
            "html": html,
        },
        timeout=15,
    )
    print(f"[daily_digest] resend status={r.status_code} body={r.text[:200]}")
    r.raise_for_status()


def main():
    signals = fetch_24h_signals()
    print(f"[daily_digest] fetched {len(signals)} signals from last 24h")
    html = render_html(signals)
    send_via_resend(html, len(signals))


if __name__ == "__main__":
    main()
