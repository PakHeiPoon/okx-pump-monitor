import "server-only";

import crypto from "node:crypto";

/**
 * 飞书应用机器人侧 SDK 简版。仅实现本项目需要的子集：
 * - URL 验证 challenge 应答
 * - 事件签名校验（HMAC-SHA256，可选——只有当应用开启 Encrypt Key 时才用）
 * - Verification Token 校验（默认走这条，对 setup 友好）
 * - tenant_access_token 获取（in-memory cache）
 * - 回复机器人消息 (im/v1/messages/{id}/reply)
 *
 * 不引入任何第三方 SDK——保持 zero dependency。
 */

export function verifyToken(payloadToken: string | undefined): boolean {
  const expected = (process.env.LARK_VERIFY_TOKEN ?? "").trim();
  if (!expected) return false;
  return payloadToken === expected;
}

// 仅在用户在飞书开放平台开启了"加密 key"时才会用到。这里实现以备用。
export function verifySignature(
  body: string,
  timestamp: string,
  nonce: string,
  signatureHeader: string | null,
): boolean {
  const encryptKey = (process.env.LARK_ENCRYPT_KEY ?? "").trim();
  if (!encryptKey) {
    // 未开启加密 → 不做签名校验（飞书在不加密模式下不发签名）
    return true;
  }
  if (!signatureHeader) return false;
  const raw = `${timestamp}${nonce}${encryptKey}${body}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return hash === signatureHeader;
}

// ============ tenant_access_token cache ============
interface CachedToken {
  token: string;
  expires_at_ms: number;
}
let tokenCache: CachedToken | null = null;

export async function getTenantAccessToken(): Promise<string> {
  const appId = (process.env.LARK_APP_ID ?? "").trim();
  const appSecret = (process.env.LARK_APP_SECRET ?? "").trim();
  if (!appId || !appSecret) {
    throw new Error("LARK_APP_ID / LARK_APP_SECRET not configured");
  }
  // 60s buffer 避免压线过期
  if (tokenCache && Date.now() < tokenCache.expires_at_ms - 60_000) {
    return tokenCache.token;
  }
  const res = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`tenant_access_token HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    code: number;
    msg: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`tenant_access_token error: code=${data.code} msg=${data.msg}`);
  }
  const expireSec = data.expire ?? 7200;
  tokenCache = {
    token: data.tenant_access_token,
    expires_at_ms: Date.now() + expireSec * 1000,
  };
  return tokenCache.token;
}

// ============ Reply to a message ============
export async function replyToMessage(
  messageId: string,
  content: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const token = await getTenantAccessToken();
    const res = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          msg_type: "text",
          content: JSON.stringify({ text: content }),
        }),
      },
    );
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 200) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, body: msg };
  }
}

// ============ Command parser ============
export type Command =
  | { kind: "mute"; minutes: number }
  | { kind: "unmute" }
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "unknown"; raw: string };

/**
 * 解析用户消息文本（已去 @）成结构化命令。
 * 支持中英混合：
 *   "mute"               → mute 30min（默认）
 *   "mute 1h" "静音 1h"   → mute 60min
 *   "mute 2h" "静音 2小时" → mute 120min
 *   "mute 90m"           → mute 90min
 *   "unmute" "取消静音"   → unmute
 *   "status" "状态"       → status
 *   "help" "帮助"         → help
 */
export function parseCommand(raw: string): Command {
  const text = raw.trim().toLowerCase();
  if (!text) return { kind: "unknown", raw };

  if (
    /^(unmute|取消静音|cancel|on|开启|恢复|解除)/i.test(text)
  ) {
    return { kind: "unmute" };
  }
  if (/^(status|状态|info)/i.test(text)) return { kind: "status" };
  if (/^(help|帮助|\?)/i.test(text)) return { kind: "help" };

  // mute / 静音
  if (/^(mute|静音|off|关闭|关掉)/i.test(text)) {
    // 提取时长：1h / 2h / 30m / 90 / 1小时 / 2hours
    const m = text.match(/(\d+)\s*(h|hr|hour|小时)/i);
    const mm = text.match(/(\d+)\s*(m|min|minute|分钟|分)/i);
    let minutes = 30; // 默认 30min
    if (m) {
      minutes = parseInt(m[1], 10) * 60;
    } else if (mm) {
      minutes = parseInt(mm[1], 10);
    } else {
      // 纯数字按分钟
      const num = text.match(/\b(\d+)\b/);
      if (num) minutes = parseInt(num[1], 10);
    }
    minutes = Math.max(1, Math.min(60 * 24, minutes)); // 1min ~ 24h
    return { kind: "mute", minutes };
  }
  return { kind: "unknown", raw };
}

// ============ Supabase mute_state writer (server-side) ============
function supabaseEnv(): { url: string; key: string } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_KEY ?? "").trim();
  if (!url || !key) throw new Error("Supabase env missing");
  return { url, key };
}

export interface MuteState {
  muted_until: string | null;
  muted_at: string | null;
  muted_by: string | null;
  reason: string | null;
  updated_at: string | null;
}

export async function fetchMuteState(): Promise<MuteState | null> {
  const { url, key } = supabaseEnv();
  const params = new URLSearchParams({ select: "*", id: "eq.1", limit: "1" });
  const res = await fetch(`${url}/rest/v1/mute_state?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as MuteState[];
  return rows[0] ?? null;
}

export async function setMuteState(
  mutedUntilIso: string | null,
  reason: string,
  by: string,
): Promise<boolean> {
  const { url, key } = supabaseEnv();
  const body = {
    id: 1,
    muted_until: mutedUntilIso,
    muted_at: mutedUntilIso ? new Date().toISOString() : null,
    muted_by: mutedUntilIso ? by : null,
    reason,
    updated_at: new Date().toISOString(),
  };
  const res = await fetch(`${url}/rest/v1/mute_state?id=eq.1`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export async function logEvent(row: {
  event_type: string;
  message_id?: string;
  chat_id?: string;
  sender_open_id?: string;
  raw_text?: string;
  parsed_cmd?: string;
  response?: string;
  ip?: string;
}): Promise<void> {
  try {
    const { url, key } = supabaseEnv();
    await fetch(`${url}/rest/v1/feishu_event_log`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch {
    // log 失败不阻塞主流程
  }
}

// ============ Status / Help text ============
export function formatMuteStatus(s: MuteState | null): string {
  if (!s || !s.muted_until) {
    return "✅ 当前未静音 · 所有信号都会推到这个群";
  }
  const until = new Date(s.muted_until);
  const now = new Date();
  if (until <= now) {
    return "✅ 静音已自动到期 · 当前活跃";
  }
  const minsLeft = Math.round((until.getTime() - now.getTime()) / 60_000);
  const untilCst = formatCst(s.muted_until);
  return `🔇 静音中 · 距到期还有 ${minsLeft}min（至 ${untilCst} CST）\n  · by ${s.muted_by ?? "?"}\n  · reason: ${s.reason ?? "?"}`;
}

function formatCst(iso: string): string {
  const dt = new Date(iso);
  const cst = new Date(dt.getTime() + 8 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(cst.getUTCMonth() + 1)}-${pad(cst.getUTCDate())} ${pad(cst.getUTCHours())}:${pad(cst.getUTCMinutes())}`;
}

export const HELP_TEXT = `📖 OKX Pump Monitor 命令
• mute / 静音           → 静音 30min
• mute 1h / 静音 1h     → 静音 1 小时
• mute 90m / 静音 90分钟 → 静音 90 分钟
• unmute / 取消静音     → 立即恢复推送
• status / 状态         → 查看当前静音状态
• help / 帮助           → 显示本帮助

🔧 cron 任务和回测在静音期间继续运行，只暂停飞书消息；
到期后自动恢复，无需手动 unmute。`;
