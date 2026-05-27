/**
 * Feishu (Lark) 应用机器人事件回调端点。
 *
 * V2.20: 性能优化
 *   - preferredRegion = ['hkg1', 'sin1']：function 部署到香港/新加坡，
 *     大幅缩短跨境 RTT（IAD1 ≈ 250ms → SIN1 ≈ 30ms 到飞书机房）
 *   - challenge fast path：URL verification 不走 lib/feishu.ts 的 heavy
 *     imports（Supabase / tenant token cache），直接 inline 解析 + echo，
 *     大幅减少 cold start 时长
 *   - lazy import：实际业务 dispatch 才动态 import @/lib/feishu，避免
 *     无关请求拖慢 challenge 路径
 *
 * 配置位置：飞书开放平台 → 你的应用 → 事件与回调 → 回调配置 → Request URL
 *   https://okx-pump-monitor.vercel.app/api/feishu/callback
 *
 * 支持的命令（消息文本去 @ 后）：
 *   mute / 静音 [Nh|Nm]   → 静音 N 时长（默认 30min）
 *   unmute / 取消静音      → 立即恢复
 *   status / 状态          → 查看当前状态
 *   help / 帮助            → 显示帮助
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
// Hobby plan: 单 region。SIN1 (新加坡) 距离飞书中国机房 ≈ 30-50ms RTT。
// 备选 'hkg1' (香港) 更近但 Vercel hobby 不一定支持。
export const preferredRegion = ["sin1"];

// ============ Fast path: URL verification challenge ============
// 飞书 SAVE Request URL 时 3s timeout 极严。这条路径必须最快：
//   - 不 import lib/feishu（含 supabase / crypto）
//   - 直接读 env + token 校验 + echo
function tryFastChallenge(body: unknown): NextResponse | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { type?: string; challenge?: string; token?: string };
  if (b.type !== "url_verification") return null;
  const expected = (process.env.LARK_VERIFY_TOKEN ?? "").trim();
  if (!expected || b.token !== expected) {
    return NextResponse.json({ error: "invalid verification token" }, { status: 401 });
  }
  return NextResponse.json({ challenge: b.challenge ?? "" });
}

// ============ Lazy-imported full dispatch ============
async function fullDispatch(rawBody: string, body: unknown, req: NextRequest): Promise<NextResponse> {
  // Dynamic import so URL verification path doesn't load these
  const {
    HELP_TEXT,
    fetchMuteState,
    formatMuteStatus,
    logEvent,
    parseCommand,
    replyToMessage,
    setMuteState,
    verifySignature,
    verifyToken,
  } = await import("@/lib/feishu");

  // 2. Signature check (仅当 Encrypt Key 启用时)
  const sig = req.headers.get("x-lark-signature");
  const ts = req.headers.get("x-lark-request-timestamp") ?? "";
  const nonce = req.headers.get("x-lark-request-nonce") ?? "";
  if (sig && !verifySignature(rawBody, ts, nonce, sig)) {
    console.warn("[feishu/callback] signature verify failed");
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  interface LarkEventEnvelope {
    schema?: string;
    header?: { event_type?: string; token?: string };
    event?: {
      sender?: { sender_id?: { open_id?: string } };
      message?: {
        message_id?: string;
        chat_id?: string;
        message_type?: string;
        content?: string;
      };
    };
  }
  const envelope = body as LarkEventEnvelope;

  // 2.5 Token check
  const eventToken = envelope.header?.token;
  if (eventToken && !verifyToken(eventToken)) {
    console.warn("[feishu/callback] event token verify failed");
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }

  // 3. Dispatch
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const ev = envelope.event;
  const msg = ev?.message;
  const messageId = msg?.message_id;
  const chatId = msg?.chat_id;
  const sender = ev?.sender?.sender_id?.open_id;

  if (!messageId) {
    await logEvent({
      event_type: envelope.header?.event_type ?? "unknown",
      response: "no message_id",
      ip,
    });
    return NextResponse.json({ ok: true, cmd: "no_message_id" });
  }

  if (msg?.message_type !== "text") {
    const reply = "🤖 我只懂文字命令哦，试试 `mute` / `unmute` / `status` / `help`";
    await replyToMessage(messageId, reply);
    await logEvent({
      event_type: envelope.header?.event_type ?? "unknown",
      message_id: messageId,
      chat_id: chatId,
      sender_open_id: sender,
      raw_text: msg?.content,
      parsed_cmd: "non_text",
      response: reply,
      ip,
    });
    return NextResponse.json({ ok: true, cmd: "non_text" });
  }

  // 去 @ 占位符
  let raw = "";
  try {
    const parsed = JSON.parse(msg.content ?? "") as { text?: string };
    raw = (parsed.text ?? "").replace(/@_user_\d+/g, "").replace(/\s+/g, " ").trim();
  } catch {
    raw = msg.content ?? "";
  }

  const cmd = parseCommand(raw);
  let reply: string;
  let cmdKey: string;

  switch (cmd.kind) {
    case "mute": {
      const until = new Date(Date.now() + cmd.minutes * 60_000);
      const reason = cmd.minutes % 60 === 0 ? `${cmd.minutes / 60}h` : `${cmd.minutes}min`;
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
    event_type: envelope.header?.event_type ?? "im.message.receive_v1",
    message_id: messageId,
    chat_id: chatId,
    sender_open_id: sender,
    raw_text: raw,
    parsed_cmd: cmdKey,
    response: reply,
    ip,
  });
  return NextResponse.json({ ok: true, cmd: cmdKey });
}

function formatCstShort(d: Date): string {
  const cst = new Date(d.getTime() + 8 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(cst.getUTCHours())}:${pad(cst.getUTCMinutes())}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();
  const rawBody = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // ===== FAST PATH: URL verification challenge =====
  // 飞书 3s timeout 严格，这条路径绝不能 import 任何 heavy lib
  const fast = tryFastChallenge(body);
  if (fast) {
    console.log(`[feishu/callback] fast challenge elapsed=${Date.now() - t0}ms`);
    return fast;
  }

  // ===== SLOW PATH: actual event dispatch =====
  try {
    const res = await fullDispatch(rawBody, body, req);
    console.log(`[feishu/callback] dispatch elapsed=${Date.now() - t0}ms`);
    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[feishu/callback] dispatch error: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET fallback for browser visit
export function GET(): NextResponse {
  return NextResponse.json({
    service: "feishu-callback",
    method: "POST only",
    setup: "https://open.feishu.cn → 你的应用 → 事件与回调 → 回调配置",
  });
}
