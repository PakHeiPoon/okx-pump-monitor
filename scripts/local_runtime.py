#!/usr/bin/env python3
"""Run the existing scanners with private local configuration and durable state."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

import requests

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".runtime"
CONFIG = RUNTIME / "credentials.json"


def load_config() -> dict[str, str]:
    if CONFIG.stat().st_mode & 0o077:
        raise RuntimeError("credentials.json must be readable only by its owner (chmod 600)")
    config = json.loads(CONFIG.read_text())
    missing = [name for name in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "FEISHU_WEBHOOK")
               if not config.get(name)]
    if missing:
        raise RuntimeError("Missing configuration: " + ", ".join(missing))
    return config


def redact(message: str, config: dict[str, str]) -> str:
    from urllib.parse import quote
    for key, value in config.items():
        if value and key != "SUPABASE_URL":
            message = message.replace(value, "[redacted]").replace(quote(value, safe=""), "[redacted]")
    return message


def heartbeat(config: dict[str, str], kind: str) -> dict | None:
    # Main records have no kind; realtime records explicitly identify themselves.
    params = {"select": "*", "order": "started_at.desc", "limit": "1"}
    params["meta->>kind"] = "eq.realtime" if kind == "realtime" else "is.null"
    response = requests.get(
        config["SUPABASE_URL"].rstrip("/") + "/rest/v1/scanner_heartbeat",
        headers={"apikey": config["SUPABASE_SERVICE_KEY"],
                 "Authorization": "Bearer " + config["SUPABASE_SERVICE_KEY"]},
        params=params, timeout=20,
    )
    response.raise_for_status()
    rows = response.json()
    return rows[0] if rows else None


def run_scan(config: dict[str, str], kind: str) -> int:
    started = time.time()
    env = {**os.environ, **config, "PYTHONUNBUFFERED": "1", "PYTHONPATH": str(ROOT)}
    # Match the original GitHub workflow; other monitor defaults already match.
    env.update(TOP_N="50", PUMP_THRESHOLD="3.0", DUMP_THRESHOLD="5.0",
               MIN_VOL_USDT="50000", LOOKBACK_BARS="16")
    module = "scanner.realtime" if kind == "realtime" else "scanner.main"
    try:
        result = subprocess.run(
            [sys.executable, "-m", module], cwd=RUNTIME, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=230,
        )
    except subprocess.TimeoutExpired as error:
        print(redact((error.stdout or b"").decode(errors="replace"), config), end="")
        raise RuntimeError(f"{kind} exceeded the 230 second runtime limit") from None
    output = redact(result.stdout.decode(errors="replace"), config)
    print(output, end="", flush=True)
    if result.returncode:
        return result.returncode
    # The existing scanner catches storage errors. A successful process alone
    # is insufficient: require a fresh heartbeat in the actual database.
    row = heartbeat(config, kind)
    if not row or datetime.fromisoformat(row["started_at"].replace("Z", "+00:00")).timestamp() < started - 2:
        raise RuntimeError(f"{kind} completed without persisting a new heartbeat")
    failed = [line for line in output.splitlines()
              if "FAILED" in line and ("[supabase]" in line or "[feishu]" in line)]
    for line in output.splitlines():
        if line.startswith("[feishu]"):
            http_status = re.match(r"\[feishu\]\s+(\d+)", line)
            code = re.search(r'"(?:code|StatusCode)"\s*:\s*(\d+)', line)
            if ((http_status and not 200 <= int(http_status.group(1)) < 300) or
                    (code and int(code.group(1)) != 0)):
                failed.append(line)
    if failed:
        raise RuntimeError("Scanner notification or storage failed; inspect the preceding log")
    print(f"Verified {kind} heartbeat id={row['id']} monitors={row['monitors_run']} "
          f"errors={row['okx_errors']} signals={row['fresh_signals']}", flush=True)
    return 1 if row["okx_errors"] >= row["monitors_run"] else 0


def watchdog(config: dict[str, str]) -> int:
    now = datetime.now(timezone.utc)
    problems = []
    for kind, max_age_minutes in (("main", 30), ("realtime", 15)):
        row = heartbeat(config, kind)
        age = None if not row else (now - datetime.fromisoformat(
            row["started_at"].replace("Z", "+00:00"))).total_seconds() / 60
        if age is None or age > max_age_minutes or row["okx_errors"] >= row["monitors_run"]:
            problems.append(f"{kind}: no usable heartbeat" if age is None else
                            f"{kind}: heartbeat age {age:.1f} minutes, errors {row['okx_errors']}")
        else:
            print(f"{kind}: healthy, heartbeat age {age:.1f} minutes")
    status = "\n".join(problems) if problems else "ok"
    state_file = RUNTIME / "watchdog-state.json"
    previous = json.loads(state_file.read_text()) if state_file.exists() else {}
    # Keep healthy checks quiet. Alert once on an outage and once on recovery;
    # repeat an unresolved outage at most hourly.
    should_alert = ((bool(problems) != bool(previous.get("problem"))) or
                    (bool(problems) and time.time() - previous.get("alerted_at", 0) >= 3600))
    if should_alert:
        text = ("🔴 OKX Monitor 扫描异常\n" + status if problems else
                "🟢 OKX Monitor 扫描已恢复，主扫描和实时扫描心跳正常。")
        response = requests.post(config["FEISHU_WEBHOOK"],
                                 json={"msg_type": "text", "content": {"text": text}}, timeout=15)
        response.raise_for_status()
        payload = response.json()
        if payload.get("code", payload.get("StatusCode", 0)) != 0:
            raise RuntimeError("Feishu rejected the watchdog notification")
        previous["alerted_at"] = time.time()
    previous["problem"] = bool(problems)
    previous["checked_at"] = now.isoformat()
    state_file.write_text(json.dumps(previous))
    return 1 if problems else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", choices=("main", "realtime", "watchdog"))
    args = parser.parse_args()
    config = load_config()
    try:
        return watchdog(config) if args.job == "watchdog" else run_scan(config, args.job)
    except Exception as error:
        print(redact(f"Local {args.job} failed: {error}", config), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
