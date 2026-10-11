#!/usr/bin/env python3
"""Install local systemd user timers; enable them only after a verified scan."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
units = Path.home() / ".config/systemd/user"
units.mkdir(parents=True, exist_ok=True)
for job, schedule in (("main", "*:0/15"), ("realtime", "*:0/5"), ("watchdog", "*:0/10")):
    name = f"okx-monitor-{job}"
    service = f"""[Unit]
Description=OKX Monitor {job}

[Service]
Type=oneshot
WorkingDirectory={root}
ExecStart={root}/.venv/bin/python {root}/scripts/local_runtime.py {job}
TimeoutStartSec=260
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
"""
    timer = f"""[Unit]
Description=Schedule OKX Monitor {job}

[Timer]
OnCalendar={schedule}
Persistent=true
AccuracySec=1s
RandomizedDelaySec=0
Unit={name}.service

[Install]
WantedBy=timers.target
"""
    (units / f"{name}.service").write_text(service)
    (units / f"{name}.timer").write_text(timer)
subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
print("Installed main (15 min), realtime (5 min), watchdog (10 min) timers.")
print("Run and verify the scanners before enabling the timers.")
