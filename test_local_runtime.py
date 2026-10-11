"""Regression checks for local persistence verification and outage notification."""
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch, Mock
from urllib.parse import quote

from scripts import local_runtime as runtime


class LocalRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_KEY": "private-service-key",
            "FEISHU_WEBHOOK": "https://example.invalid/webhook/private-hook",
            "ETHERSCAN_KEY": "private+etherscan/key",
        }

    def test_zero_exit_without_persisted_heartbeat_is_failure(self):
        process = subprocess.CompletedProcess([], 0, stdout=b"scanner completed\n")
        with patch.object(runtime.subprocess, "run", return_value=process), \
             patch.object(runtime, "heartbeat", return_value=None), \
             patch("sys.stdout", new=io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "persisting a new heartbeat"):
                runtime.run_scan(self.config, "main")

    def test_old_heartbeat_cannot_validate_current_scan(self):
        process = subprocess.CompletedProcess([], 0, stdout=b"scanner completed\n")
        with patch.object(runtime.subprocess, "run", return_value=process), \
             patch.object(runtime, "heartbeat", return_value={"started_at": "2000-01-01T00:00:00Z"}), \
             patch("sys.stdout", new=io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "persisting a new heartbeat"):
                runtime.run_scan(self.config, "realtime")

    def test_sensitive_values_and_encoded_query_keys_are_redacted(self):
        text = " ".join(self.config.values()) + " " + quote(self.config["ETHERSCAN_KEY"], safe="")
        result = runtime.redact(text, self.config)
        for key, value in self.config.items():
            if key != "SUPABASE_URL":
                self.assertNotIn(value, result)
                self.assertNotIn(quote(value, safe=""), result)

    def test_failed_feishu_delivery_cannot_report_success(self):
        process = subprocess.CompletedProcess([], 0, stdout=b'[feishu] 200 {"code":19021}\n')
        row = {"started_at": datetime.now(timezone.utc).isoformat()}
        with patch.object(runtime.subprocess, "run", return_value=process), \
             patch.object(runtime, "heartbeat", return_value=row), \
             patch("sys.stdout", new=io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "notification or storage failed"):
                runtime.run_scan(self.config, "main")

    def test_watchdog_checks_both_scanners_and_deduplicates_outage(self):
        healthy = {"started_at": datetime.now(timezone.utc).isoformat(),
                   "okx_errors": 0, "monitors_run": 2}
        stale = {**healthy, "started_at": "2000-01-01T00:00:00Z"}
        response = Mock()
        response.json.return_value = {"code": 0}
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(runtime, "RUNTIME", Path(directory)), \
             patch.object(runtime.requests, "post", return_value=response) as send, \
             patch("sys.stdout", new=io.StringIO()), \
             patch.object(runtime, "heartbeat", side_effect=[
                 healthy, healthy, healthy, stale, healthy, stale, healthy, healthy]):
            self.assertEqual(runtime.watchdog(self.config), 0)
            send.assert_not_called()
            self.assertEqual(runtime.watchdog(self.config), 1)
            self.assertEqual(send.call_count, 1)
            self.assertEqual(runtime.watchdog(self.config), 1)
            self.assertEqual(send.call_count, 1)
            self.assertEqual(runtime.watchdog(self.config), 0)
            self.assertEqual(send.call_count, 2)
            self.assertFalse(json.loads((Path(directory) / "watchdog-state.json").read_text())["problem"])


if __name__ == "__main__":
    unittest.main()
