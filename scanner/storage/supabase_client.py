"""Supabase REST API 封装。未配置 SUPABASE_URL 时所有方法 noop，向后兼容。
不引入 supabase-py SDK，用 requests 直接打 REST，零额外依赖。"""
from datetime import datetime, timezone

import requests


class SupabaseClient:
    def __init__(self, url, service_key):
        self.url = url
        self.service_key = service_key
        self.enabled = bool(url and service_key)
        self._headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

    def insert_signals(self, signals):
        """signals: list[Signal] —— 转 dict 后批量 insert。"""
        if not self.enabled or not signals:
            return
        rows = [self._signal_to_row(s) for s in signals]
        try:
            r = requests.post(
                f"{self.url}/rest/v1/signals",
                headers=self._headers,
                json=rows,
                timeout=10,
            )
            r.raise_for_status()
            print(f"[supabase] inserted {len(rows)} signals")
        except Exception as e:
            print(f"[supabase] insert FAILED: {e}")

    @staticmethod
    def _signal_to_row(s):
        bar_ts_iso = datetime.fromtimestamp(s.bar_ts_ms / 1000, timezone.utc).isoformat()
        return {
            "inst_id":    s.inst_id,
            "direction":  s.direction,
            "chg_pct":    s.chg_pct,
            "vol_usdt":   s.vol_usdt,
            "bars":       s.bars,
            "open_price": s.open_price,
            "close_price": s.close_price,
            "bar_ts":     bar_ts_iso,
            "source":     s.source,
        }
