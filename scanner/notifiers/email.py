"""邮件通知（Resend）。V2 实装——每日汇总，不在 scanner 主流程实时调用。
当前 stub：实时调用直接 noop，避免每根信号都发邮件。"""
from .base import Notifier


class EmailDailyDigestNotifier(Notifier):
    """V2 占位。实际逻辑由独立 GH Actions 定时任务（每天一次）拉 Supabase
    最近 24h signals 聚合 → Resend API 发邮件。"""
    name = "email_daily_digest"

    def __init__(self, resend_api_key=None, to_email=None):
        self.resend_api_key = resend_api_key
        self.to_email = to_email

    def send(self, signals):
        # 实时调用 noop：邮件走每日汇总，不要被实时信号触发
        return
