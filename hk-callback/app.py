"""Feishu (Lark) 应用机器人事件回调 —— HK 自托管版（V2.23）。

为什么有这个目录：
  Vercel SIN1 跨境 → Feishu 北京机房 RTT 300ms+，3s timeout 经常炸（V2.20/V2.21
  都未根治）。迁到 HK Lighthouse（IP 124.156.170.240），RTT ≈ 30ms，
  Feishu SAVE URL 一次过。

技术栈选型：
  - FastAPI + uvicorn：单进程异步，开机 200ms 起，内存 ~80MB
  - httpx：异步 HTTP 客户端，跟 Feishu / Supabase 通信
  - 不引第三方 Lark SDK：保持 zero dep 风格跟原 TS 版一致

兼容性：
  - 飞书事件订阅 v2 (schema 2.0)
  - 也兼容 url_verification challenge 应答
  - 可选签名校验（仅当开启 Encrypt Key 时）
"""
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# ============ 配置 ============
LARK_APP_ID         = os.environ.get("LARK_APP_ID", "").strip()
LARK_APP_SECRET     = os.environ.get("LARK_APP_SECRET", "").strip()
LARK_VERIFY_TOKEN   = os.environ.get("LARK_VERIFY_TOKEN", "").strip()
LARK_ENCRYPT_KEY    = os.environ.get("LARK_ENCRYPT_KEY", "").strip()
SUPABASE_URL        = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY        = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
CST                 = timezone(timedelta(hours=8))

app = FastAPI()
_token_cache: dict[str, Any] = {"token": None, "expires_at_ms": 0}


# ============ tenant_access_token cache ============
async def get_tenant_access_token(client: httpx.AsyncClient) -> str:
    if not LARK_APP_ID or not LARK_APP_SECRET:
        raise RuntimeError("LARK_APP_ID / LARK_APP_SECRET not configured")
    now_ms = int(time.time() * 1000)
    if _token_cache["token"] and now_ms < _token_cache["expires_at_ms"] - 60_000:
        return _token_cache["token"]
    res = await client.post(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": LARK_APP_ID, "app_secret": LARK_APP_SECRET},
        timeout=8.0,
    )
    res.raise_for_status()
    data = res.json()
    if data.get("code") != 0 or not data.get("tenant_access_token"):
        raise RuntimeError(f"tenant_access_token err code={data.get('code')} msg={data.get('msg')}")
    _token_cache["token"] = data["tenant_access_token"]
    _token_cache["expires_at_ms"] = now_ms + (data.get("expire", 7200) * 1000)
    return _token_cache["token"]


# ============ 签名校验 ============
def verify_signature(body: bytes, ts: str, nonce: str, sig_header: str | None) -> bool:
    if not LARK_ENCRYPT_KEY:
        return True  # 未开加密，跳过
    if not sig_header:
        return False
    raw = f"{ts}{nonce}{LARK_ENCRYPT_KEY}".encode() + body
    return hashlib.sha256(raw).hexdigest() == sig_header


def verify_token(payload_token: str | None) -> bool:
    return bool(LARK_VERIFY_TOKEN) and payload_token == LARK_VERIFY_TOKEN


# ============ 命令解析 ============
def parse_command(raw: str) -> dict[str, Any]:
    text = raw.strip().lower()
    if not text:
        return {"kind": "unknown", "raw": raw}
    if re.match(r"^(unmute|取消静音|cancel|on|开启|恢复|解除)", text, re.I):
        return {"kind": "unmute"}
    if re.match(r"^(status|状态|info)", text, re.I):
        return {"kind": "status"}
    if re.match(r"^(help|帮助|\?)", text, re.I):
        return {"kind": "help"}
    if re.match(r"^(mute|静音|off|关闭|关掉)", text, re.I):
        # 提取时长
        m_h = re.search(r"(\d+)\s*(h|hr|hour|小时)", text, re.I)
        m_m = re.search(r"(\d+)\s*(m|min|minute|分钟|分)", text, re.I)
        minutes = 30
        if m_h:
            minutes = int(m_h.group(1)) * 60
        elif m_m:
            minutes = int(m_m.group(1))
        else:
            m_n = re.search(r"\b(\d+)\b", text)
            if m_n:
                minutes = int(m_n.group(1))
        minutes = max(1, min(60 * 24, minutes))
        return {"kind": "mute", "minutes": minutes}
    return {"kind": "unknown", "raw": raw}


# ============ Supabase mute_state ============
async def fetch_mute_state(client: httpx.AsyncClient) -> dict | None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/mute_state",
            params={"select": "*", "id": "eq.1", "limit": "1"},
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=5.0,
        )
        if r.status_code != 200:
            return None
        rows = r.json()
        return rows[0] if rows else None
    except Exception:
        return None


async def set_mute_state(client: httpx.AsyncClient, muted_until_iso: str | None, reason: str, by: str) -> bool:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False
    body = {
        "id": 1,
        "muted_until": muted_until_iso,
        "muted_at": datetime.now(timezone.utc).isoformat() if muted_until_iso else None,
        "muted_by": by if muted_until_iso else None,
        "reason": reason,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        r = await client.patch(
            f"{SUPABASE_URL}/rest/v1/mute_state",
            params={"id": "eq.1"},
            json=body,
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            timeout=5.0,
        )
        return r.status_code in (200, 204)
    except Exception:
        return False


async def log_event(client: httpx.AsyncClient, row: dict) -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    try:
        await client.post(
            f"{SUPABASE_URL}/rest/v1/feishu_event_log",
            json=row,
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            timeout=5.0,
        )
    except Exception:
        pass  # 日志失败不阻塞主流程


def format_cst(iso: str) -> str:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(CST)
    return dt.strftime("%m-%d %H:%M")


def format_cst_short(dt: datetime) -> str:
    cst = dt.astimezone(CST)
    return cst.strftime("%H:%M")


def format_mute_status(s: dict | None) -> str:
    if not s or not s.get("muted_until"):
        return "✅ 当前未静音 · 所有信号都会推到这个群"
    until = datetime.fromisoformat(s["muted_until"].replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    if until <= now:
        return "✅ 静音已自动到期 · 当前活跃"
    mins_left = int((until - now).total_seconds() / 60)
    until_cst = format_cst(s["muted_until"])
    return (
        f"🔇 静音中 · 距到期还有 {mins_left}min（至 {until_cst} CST）\n"
        f"  · by {s.get('muted_by','?')}\n"
        f"  · reason: {s.get('reason','?')}"
    )


HELP_TEXT = """📖 OKX Pump Monitor 命令
• mute / 静音           → 静音 30min
• mute 1h / 静音 1h     → 静音 1 小时
• mute 90m / 静音 90分钟 → 静音 90 分钟
• unmute / 取消静音     → 立即恢复推送
• status / 状态         → 查看当前静音状态
• help / 帮助           → 显示本帮助

🔧 cron 任务和回测在静音期间继续运行，只暂停飞书消息；
到期后自动恢复，无需手动 unmute。"""


# ============ Reply ============
async def reply_message(client: httpx.AsyncClient, message_id: str, content: str) -> None:
    try:
        token = await get_tenant_access_token(client)
        await client.post(
            f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}/reply",
            json={"msg_type": "text", "content": json.dumps({"text": content})},
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json; charset=utf-8",
            },
            timeout=8.0,
        )
    except Exception as e:
        print(f"[reply] err: {e}", flush=True)


# ============ 路由 ============
@app.get("/feishu/callback")
@app.get("/healthz")
async def healthz() -> JSONResponse:
    return JSONResponse({
        "service": "feishu-callback",
        "method": "POST only",
        "ts": datetime.now(CST).isoformat(),
    })


@app.post("/feishu/callback")
async def callback(req: Request) -> JSONResponse:
    t0 = time.time()
    raw_body = await req.body()
    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError:
        return JSONResponse({"error": "bad json"}, status_code=400)

    # ===== FAST PATH: URL verification =====
    if isinstance(body, dict) and body.get("type") == "url_verification":
        if not verify_token(body.get("token")):
            return JSONResponse({"error": "invalid verification token"}, status_code=401)
        elapsed = int((time.time() - t0) * 1000)
        print(f"[challenge] elapsed={elapsed}ms ✓", flush=True)
        return JSONResponse({"challenge": body.get("challenge", "")})

    # ===== SLOW PATH =====
    async with httpx.AsyncClient() as client:
        # 签名校验
        sig = req.headers.get("x-lark-signature")
        ts = req.headers.get("x-lark-request-timestamp", "")
        nonce = req.headers.get("x-lark-request-nonce", "")
        if sig and not verify_signature(raw_body, ts, nonce, sig):
            return JSONResponse({"error": "bad signature"}, status_code=401)

        header = body.get("header", {})
        event_type = header.get("event_type", "unknown")

        # token 校验
        event_token = header.get("token")
        if event_token and not verify_token(event_token):
            return JSONResponse({"error": "bad token"}, status_code=401)

        ip = req.headers.get("x-forwarded-for", "unknown")
        ev = body.get("event", {})
        msg = ev.get("message", {})
        message_id = msg.get("message_id")
        chat_id = msg.get("chat_id")
        sender = ev.get("sender", {}).get("sender_id", {}).get("open_id")

        if not message_id:
            await log_event(client, {"event_type": event_type, "response": "no message_id", "ip": ip})
            return JSONResponse({"ok": True, "cmd": "no_message_id"})

        if msg.get("message_type") != "text":
            reply = "🤖 我只懂文字命令哦，试试 `mute` / `unmute` / `status` / `help`"
            await reply_message(client, message_id, reply)
            await log_event(client, {
                "event_type": event_type, "message_id": message_id, "chat_id": chat_id,
                "sender_open_id": sender, "raw_text": msg.get("content"), "parsed_cmd": "non_text",
                "response": reply, "ip": ip,
            })
            return JSONResponse({"ok": True, "cmd": "non_text"})

        # 去 @ 占位
        try:
            parsed = json.loads(msg.get("content") or "{}")
            raw = (parsed.get("text") or "")
        except Exception:
            raw = msg.get("content") or ""
        raw = re.sub(r"@_user_\d+", "", raw)
        raw = re.sub(r"\s+", " ", raw).strip()

        cmd = parse_command(raw)
        reply: str
        cmd_key: str

        if cmd["kind"] == "mute":
            mins = cmd["minutes"]
            until = datetime.now(timezone.utc) + timedelta(minutes=mins)
            reason = f"{mins // 60}h" if mins % 60 == 0 else f"{mins}min"
            ok = await set_mute_state(client, until.isoformat(), reason, sender or "?")
            reply = (
                f"🔇 已静音 {reason}，到 {format_cst_short(until)} CST 自动恢复\n"
                f"  · cron + 回测继续跑\n"
                f"  · 回复 `unmute` 可立即取消"
                if ok else
                "❌ 写入 mute_state 失败，检查 Supabase 连接"
            )
            cmd_key = f"mute_{mins}m"
        elif cmd["kind"] == "unmute":
            ok = await set_mute_state(client, None, "off", sender or "?")
            reply = "✅ 已取消静音 · 信号推送恢复" if ok else "❌ 写入失败"
            cmd_key = "unmute"
        elif cmd["kind"] == "status":
            state = await fetch_mute_state(client)
            reply = format_mute_status(state)
            cmd_key = "status"
        elif cmd["kind"] == "help":
            reply = HELP_TEXT
            cmd_key = "help"
        else:
            reply = f'❓ 没看懂 "{cmd.get("raw", raw)}"\n{HELP_TEXT}'
            cmd_key = "unknown"

        await reply_message(client, message_id, reply)
        await log_event(client, {
            "event_type": event_type, "message_id": message_id, "chat_id": chat_id,
            "sender_open_id": sender, "raw_text": raw, "parsed_cmd": cmd_key,
            "response": reply, "ip": ip,
        })
        elapsed = int((time.time() - t0) * 1000)
        print(f"[dispatch] cmd={cmd_key} elapsed={elapsed}ms", flush=True)
        return JSONResponse({"ok": True, "cmd": cmd_key})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
