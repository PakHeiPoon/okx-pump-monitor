"""Supabase REST API 封装。未配置 SUPABASE_URL 时所有方法 noop，向后兼容。
不引入 supabase-py SDK，用 requests 直接打 REST，零额外依赖。"""
from datetime import datetime, timezone

import requests


class SupabaseClient:
    def __init__(self, url, service_key):
        self.url = url
        self.service_key = service_key
        self.enabled = bool(url and service_key)
        self._headers_read = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        }
        self._headers_write = {
            **self._headers_read,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }

    # ============ 写 signals ============
    def insert_signals(self, signals):
        """signals: list[Signal] —— 转 dict 后批量 insert。"""
        if not self.enabled or not signals:
            return
        rows = [self._signal_to_row(s) for s in signals]
        try:
            r = requests.post(
                f"{self.url}/rest/v1/signals",
                headers=self._headers_write,
                json=rows,
                timeout=10,
            )
            r.raise_for_status()
            print(f"[supabase] inserted {len(rows)} signals")
        except Exception as e:
            print(f"[supabase] insert FAILED: {e}")

    # ============ 读 watchlist ============
    def fetch_watchlist(self):
        """返回 list[dict]，每个 dict 含 symbol/inst_id/pump_threshold_override/dump_threshold_override。
        Supabase 没配或拉失败时返回 []（graceful，scanner 继续跑）。"""
        if not self.enabled:
            return []
        try:
            r = requests.get(
                f"{self.url}/rest/v1/watchlist",
                headers={**self._headers_read, "Accept": "application/json"},
                params={"select": "*"},
                timeout=10,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"[supabase] fetch_watchlist FAILED: {e}")
            return []

    # ============ 读 monitor_config ============
    def fetch_monitor_config(self):
        """返回 dict 或 None（未配置时）。包含 pump_threshold / dump_threshold / top_n / ..."""
        if not self.enabled:
            return None
        try:
            r = requests.get(
                f"{self.url}/rest/v1/monitor_config",
                headers={**self._headers_read, "Accept": "application/json"},
                params={"select": "*", "limit": "1"},
                timeout=10,
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0] if rows else None
        except Exception as e:
            print(f"[supabase] fetch_monitor_config FAILED: {e}")
            return None

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
