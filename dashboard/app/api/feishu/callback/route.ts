/**
 * Feishu (Lark) 应用机器人事件回调端点。
 *
 * 配置位置：飞书开放平台 → 你的应用 → 事件订阅 → Request URL
 *   设为：https://okx-pump-monitor.vercel.app/api/feishu/callback
 *
 * 支持的事件：
 *   1. url_verification          (首次配置时飞书发 challenge → 我们 echo 回去)
 *   2. im.message.receive_v1     (用户在群里 @ 机器人发消息)
 *
 * 支持的命令（消息文本去 @ 后）：
 *   mute / 静音 [Nh|Nm]   → 静音 N 时长（默认 30min）
 *   unmute / 取消静音      → 立即恢复
 *   status / 状态          → 查看当前状态
 *   help / 帮助            → 显示帮助
 *
 * 安全：
 *   - LARK_VERIFY_TOKEN 必须配（payload 里 token 比对）
 *   - LARK_ENCRYPT_KEY 可选（飞书侧开启加密时才用，本路由会自动签名校验）
 */
import { NextRequest, NextResponse } from "next/server";

import {
  HELP_TEXT,
  fetchMuteState,
  formatMuteStatus,
  logEvent,
  parseCommand,
  replyToMessage,
  setMuteState,
  verifySignature,
  verifyToken,
} from "@/lib/feishu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface LarkChallengeBody {
  type: "url_verification";
  challenge: string;
  token: string;
}

interface LarkEventEnvelope {
  schema?: string;
  header?: {
    event_id?: string;
    event_type?: string;
    token?: string;
    create_time?: string;
    tenant_key?: string;
    app_id?: string;
  };
  event?: LarkMessageEvent;
}

interface LarkMessageEvent {
  sender?: {
    sender_id?: {
      open_id?: string;
      union_id?: string;
      user_id?: string;
    };
    sender_type?: string;
  };
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;            // JSON string: {"text":"@_user_1 mute 1h"}
    mentions?: Array<{
      key: string;
      id?: { open_id?: string; user_id?: string };
      name?: string;
    }>;
  };
}

function stripMentions(content: string | undefined): string {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content) as { text?: string };
    const text = parsed.text ?? "";
    // 飞书 @ 用户在 text 里渲染为 @_user_1 / @_user_2 等占位符，去掉
    return text.replace(/@_user_\d+/g, "").replace(/\s+/g, " ").trim();
  } catch {
    return content;
  }
}

interface ChallengeHandlerResult {
  type: "challenge";
  response: NextResponse;
}

function handleChallenge(body: LarkChallengeBody): ChallengeHandlerResult {
  // 飞书 setup 阶段 challenge —— 这里同时校验 token（防止有人乱发请求）
  if (!verifyToken(body.token)) {
    return {
      type: "challenge",
      response: NextResponse.json(
        { error: "invalid verification token" },
        { status: 401 },
      ),
    };
  }
  return {
    type: "challenge",
    response: NextResponse.json({ challenge: body.challenge }),
  };
}

async function dispatch(env: LarkEventEnvelope, ip: string): Promise<string> {
  const ev = env.event;
  const msg = ev?.message;
  const messageId = msg?.message_id;
  const chatId = msg?.chat_id;
  const sender = ev?.sender?.sender_id?.open_id;

  if (!messageId) {
    await logEvent({
      event_type: env.header?.event_type ?? "unknown",
      response: "no message_id",
      ip,
    });
    return "no message_id";
  }

  if (msg?.message_type !== "text") {
    const reply = "🤖 我只懂文字命令哦，试试 `mute` / `unmute` / `status` / `help`";
    await replyToMessage(messageId, reply);
    await logEvent({
      event_type: env.header?.event_type ?? "unknown",
      message_id: messageId,
      chat_id: chatId,
      sender_open_id: sender,
      raw_text: msg?.content,
      parsed_cmd: "non_text",
      response: reply,
      ip,
    });
    return "non_text";
  }

  const raw = stripMentions(msg.content);
  const cmd = parseCommand(raw);
  let reply: string;
  let cmdKey: string;

  switch (cmd.kind) {
    case "mute": {
      const until = new Date(Date.now() + cmd.minutes * 60_000);
      const reason =
        cmd.minutes % 60 === 0
          ? `${cmd.minutes / 60}h`
          : `${cmd.minutes}min`;
      const ok = await setMuteState(until.toISOString(), reason, sender ?? "?");
      reply = ok
        ? `🔇 已静音 ${reason}，到 ${formatCstShort(until)} CST 自动恢复\n  · cron + 回测继续跑\n  · 回复 \`unmute\` 可立即取消`
        : "❌ 写入 mute_state 失败，检查 Supabase 连接";
      cmdKey = `mute_${cmd.minutes}m`;
      break;
    }
    case "unmute": {
      const ok = await setMuteState(null, "off", sender ?? "?");
      reply = ok ? "✅ 已取消静音 · 信号推送恢复" : "❌ 写入失败";
      cmdKey = "unmute";
      break;
    }
    case "status": {
      const state = await fetchMuteState();
      reply = formatMuteStatus(state);
      cmdKey = "status";
      break;
    }
    case "help": {
      reply = HELP_TEXT;
      cmdKey = "help";
      break;
    }
    case "unknown":
    default: {
      reply = `❓ 没看懂"${cmd.kind === "unknown" ? cmd.raw : raw}"\n${HELP_TEXT}`;
      cmdKey = "unknown";
      break;
    }
  }

  await replyToMessage(messageId, reply);
  await logEvent({
    event_type: env.header?.event_type ?? "im.message.receive_v1",
    message_id: messageId,
    chat_id: chatId,
    sender_open_id: sender,
    raw_text: raw,
    parsed_cmd: cmdKey,
    response: reply,
    ip,
  });
  return cmdKey;
}

function formatCstShort(d: Date): string {
  const cst = new Date(d.getTime() + 8 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(cst.getUTCHours())}:${pad(cst.getUTCMinutes())}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip =
    req.headers.get("x-forwarded-for") ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const rawBody = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const obj = body as { type?: string; challenge?: string; token?: string };

  // 1. URL verification（首次配置）
  if (obj.type === "url_verification") {
    console.log("[feishu/callback] URL verification challenge received");
    const out = handleChallenge(body as LarkChallengeBody);
    return out.response;
  }

  // 2. Signature check（仅当 Encrypt Key 启用时；未启用走 token 校验）
  const sig = req.headers.get("x-lark-signature");
  const ts = req.headers.get("x-lark-request-timestamp") ?? "";
  const nonce = req.headers.get("x-lark-request-nonce") ?? "";
  if (sig && !verifySignature(rawBody, ts, nonce, sig)) {
    console.warn("[feishu/callback] signature verify failed");
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // 2.5 Token check（事件 envelope 里 header.token）
  const envelope = body as LarkEventEnvelope;
  const eventToken = envelope.header?.token;
  if (eventToken && !verifyToken(eventToken)) {
    console.warn("[feishu/callback] event token verify failed");
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }

  // 3. Event dispatch
  try {
    const cmdKey = await dispatch(envelope, ip);
    console.log(`[feishu/callback] dispatched cmd=${cmdKey}`);
    // 飞书要求 200 + 任意 JSON body
    return NextResponse.json({ ok: true, cmd: cmdKey });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[feishu/callback] dispatch error: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET fallback — 浏览器直接打开时显示提示，不让用户以为页面挂了
export function GET(): NextResponse {
  return NextResponse.json({
    service: "feishu-callback",
    method: "POST only",
    setup: "https://open.feishu.cn → 你的应用 → 事件订阅",
  });
}
