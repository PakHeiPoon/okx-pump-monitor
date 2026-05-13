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

    # ============ 读 breakout_levels ============
    def fetch_breakout_levels(self):
        if not self.enabled:
            return []
        try:
            r = requests.get(
                f"{self.url}/rest/v1/breakout_levels",
                headers={**self._headers_read, "Accept": "application/json"},
                params={"select": "*", "enabled": "eq.true"},
                timeout=10,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"[supabase] fetch_breakout_levels FAILED: {e}")
            return []

    def update_breakout_triggered(self, level_id, ts_iso):
        if not self.enabled:
            return
        try:
            r = requests.patch(
                f"{self.url}/rest/v1/breakout_levels?id=eq.{level_id}",
                headers=self._headers_write,
                json={"last_triggered_at": ts_iso},
                timeout=10,
            )
            r.raise_for_status()
        except Exception as e:
            print(f"[supabase] update_breakout_triggered FAILED: {e}")

    # ============ 读 price_alerts ============
    def fetch_active_price_alerts(self):
        """只取还没触发过的 enabled alerts。"""
        if not self.enabled:
            return []
        try:
            r = requests.get(
                f"{self.url}/rest/v1/price_alerts",
                headers={**self._headers_read, "Accept": "application/json"},
                params={
                    "select": "*",
                    "enabled": "eq.true",
                    "triggered_at": "is.null",
                },
                timeout=10,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"[supabase] fetch_active_price_alerts FAILED: {e}")
            return []

    def mark_price_alert_triggered(self, alert_id, ts_iso):
        if not self.enabled:
            return
        try:
            r = requests.patch(
                f"{self.url}/rest/v1/price_alerts?id=eq.{alert_id}",
                headers=self._headers_write,
                json={"triggered_at": ts_iso},
                timeout=10,
            )
            r.raise_for_status()
        except Exception as e:
            print(f"[supabase] mark_price_alert_triggered FAILED: {e}")

    # ============ OI snapshots ============
    def fetch_oi_snapshots(self):
        """返回 {inst_id: {oi, oi_ccy, oi_usd, snapshot_at}}"""
        if not self.enabled:
            return {}
        try:
            r = requests.get(
                f"{self.url}/rest/v1/oi_snapshots",
                headers={**self._headers_read, "Accept": "application/json"},
                params={"select": "*"},
                timeout=10,
            )
            r.raise_for_status()
            rows = r.json()
            return {r_["inst_id"]: r_ for r_ in rows}
        except Exception as e:
            print(f"[supabase] fetch_oi_snapshots FAILED: {e}")
            return {}

    def upsert_oi_snapshots(self, snapshots):
        """snapshots: list[dict(inst_id, oi, oi_ccy, oi_usd)]。批量 upsert。"""
        if not self.enabled or not snapshots:
            return
        rows = [
            {
                "inst_id": s["inst_id"],
                "oi": s["oi"],
                "oi_ccy": s.get("oi_ccy"),
                "oi_usd": s.get("oi_usd"),
                "snapshot_at": "now()",
            }
            for s in snapshots
        ]
        # 让 Supabase 跑 default now() — 不传 snapshot_at
        for r_ in rows:
            r_.pop("snapshot_at", None)
        try:
            r = requests.post(
                f"{self.url}/rest/v1/oi_snapshots",
                headers={**self._headers_write, "Prefer": "resolution=merge-duplicates,return=minimal"},
                json=rows,
                timeout=15,
            )
            r.raise_for_status()
        except Exception as e:
            print(f"[supabase] upsert_oi_snapshots FAILED: {e}")

    # ============ scanner_heartbeat (V2.8 watchdog) ============
    def insert_heartbeat(self, hb):
        """hb: dict with keys started_at(iso), duration_ms, monitors_run,
        signals_found, fresh_signals, okx_errors, meta(dict)."""
        if not self.enabled:
            return
        try:
            r = requests.post(
                f"{self.url}/rest/v1/scanner_heartbeat",
                headers=self._headers_write,
                json=hb,
                timeout=10,
            )
            r.raise_for_status()
        except Exception as e:
            print(f"[supabase] insert_heartbeat FAILED: {e}")

    def fetch_latest_heartbeat(self):
        """返回最新一条 heartbeat dict 或 None。"""
        if not self.enabled:
            return None
        try:
            r = requests.get(
                f"{self.url}/rest/v1/scanner_heartbeat",
                headers={**self._headers_read, "Accept": "application/json"},
                params={
                    "select": "*",
                    "order": "started_at.desc",
                    "limit": "1",
                },
                timeout=10,
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0] if rows else None
        except Exception as e:
            print(f"[supabase] fetch_latest_heartbeat FAILED: {e}")
            return None

    # ============ liquidations (V2.8 monitor) ============
    def insert_liquidations(self, rows):
        """rows: list[dict(inst_id, side, price, sz, notional_usd, ts(iso))]."""
        if not self.enabled or not rows:
            return
        try:
            r = requests.post(
                f"{self.url}/rest/v1/liquidations",
                headers=self._headers_write,
                json=rows,
                timeout=10,
            )
            r.raise_for_status()
        except Exception as e:
            print(f"[supabase] insert_liquidations FAILED: {e}")

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
            "meta":       s.meta if isinstance(s.meta, dict) else {},
        }
