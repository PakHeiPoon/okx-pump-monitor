# Local scanner timers

The production scanners can run directly on this machine using systemd user
timers, without GitHub Actions scheduling or runner minutes. The existing Vercel
dashboard and Supabase database remain connected to the same scanners.

| Job | Schedule | What it does |
| --- | --- | --- |
| `okx-monitor-main` | Every 15 minutes | Run the existing main scanner |
| `okx-monitor-realtime` | Every 5 minutes | Run both reversal monitors |
| `okx-monitor-watchdog` | Every 10 minutes | Check both scanner heartbeats and report outages to the existing Feishu webhook |

Timers align to the clock with one-second accuracy and no randomized delay.
Each service allows only one invocation at a time. State and configuration live
in `.runtime/`, which is ignored by Git. Scans require a newly persisted heartbeat
before they report success, and sensitive configuration is redacted from logs.
The watchdog stays quiet while healthy; it sends an outage notification once,
repeats it at most hourly, and sends a recovery notification when both scans
are healthy again.

## Install

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
mkdir -m 700 -p .runtime
```

Create `.runtime/credentials.json` with the existing values for `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `FEISHU_WEBHOOK`, and optionally `ETHERSCAN_KEY`. Do not
commit this file or paste its contents into logs. Set permissions with:

```bash
chmod 600 .runtime/credentials.json
.venv/bin/python scripts/install_local_timers.py
systemctl --user start okx-monitor-main.service okx-monitor-realtime.service
journalctl --user -u okx-monitor-main.service -u okx-monitor-realtime.service -n 60
```

After verifying both scans, disable the old GitHub workflows to avoid duplicate
scans, enable user lingering so jobs survive logout, and enable the timers:

```bash
gh workflow disable scan.yml --repo PakHeiPoon/okx-pump-monitor
gh workflow disable scan-realtime.yml --repo PakHeiPoon/okx-pump-monitor
gh workflow disable watchdog.yml --repo PakHeiPoon/okx-pump-monitor
sudo loginctl enable-linger "$USER"
systemctl --user enable --now okx-monitor-main.timer okx-monitor-realtime.timer okx-monitor-watchdog.timer
systemctl --user list-timers 'okx-monitor-*'
```

This local setup replaces the scanner and watchdog schedules. Daily email
digests and the Feishu callback retain their existing deployment configuration.
The installer does not change those routes or enable email delivery.

## Operations

```bash
systemctl --user list-timers 'okx-monitor-*'
journalctl --user -u okx-monitor-main.service -u okx-monitor-realtime.service -u okx-monitor-watchdog.service -n 80
.venv/bin/python scripts/local_runtime.py watchdog
```

To stop local scheduling:

```bash
systemctl --user disable --now okx-monitor-main.timer okx-monitor-realtime.timer okx-monitor-watchdog.timer
```

To return to GitHub Actions, stop the local timers before enabling the original
workflows. Public repositories can have scheduled workflows disabled after
60 days without repository activity, so the local timers are the persistent
production scheduler for this installation.
