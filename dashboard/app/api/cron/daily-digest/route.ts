/**
 * Vercel Cron Job: Daily Signal Digest Email
 *
 * Schedule: 每天北京时间 09:00 = UTC 01:00（configured in dashboard/vercel.json）。
 *
 * Migrated from scanner/daily_digest.py + .github/workflows/daily-digest.yml.
 * 拉过去 24h 的 Supabase signals，渲染深色主题 HTML 邮件，经 Resend 发出。
 *
 * 环境变量（Vercel Project Settings）：
 *   CRON_SECRET             — 路由鉴权（与 watchdog 共用同一个）
 *   SUPABASE_URL            — Supabase 项目地址
 *   SUPABASE_SERVICE_KEY    — service role key（仅 server 侧）
 *   RESEND_API_KEY          — Resend API key
 *   DIGEST_TO_EMAIL         — 收件人
 *   DIGEST_FROM_EMAIL       — 发件人（必须 Resend verified domain 或 onboarding@resend.dev）
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow up to 60s for fetching + rendering + sending the email.
export const maxDuration = 60;

interface SignalRow {
  id: number;
  inst_id: string;
  symbol: string | null;
  direction: string;
  chg_pct: number;
  vol_usdt: number;
  source: string;
  detected_at: string;
  meta?: Record<string, unknown>;
}

interface SourceLabel {
  emoji: string;
  label: string;
}

const SOURCE_LABELS: Record<string, SourceLabel> = {
  swap_top_gainers: { emoji: "🚀", label: "TOP50 15分钟拉升/闪崩" },
  watchlist: { emoji: "🎯", label: "Watchlist 自选盯盘" },
  volume_surge: { emoji: "📊", label: "成交量突变" },
  funding_extreme: { emoji: "💰", label: "资金费率极端" },
  breakout: { emoji: "⚡", label: "突破前高/前低" },
  price_alert: { emoji: "🔔", label: "目标价/止损价" },
  oi_surge: { emoji: "📈", label: "持仓量异动" },
  perp_premium: { emoji: "💱", label: "合约-现货价差" },
  new_listings: { emoji: "🆕", label: "新上架合约" },
  longshort_ratio: { emoji: "⚖️", label: "散户多空比极端" },
  liquidations: { emoji: "💀", label: "强平爆仓密集" },
  cross_exchange: { emoji: "🔀", label: "跨所价差" },
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function fetch24hSignals(): Promise<SignalRow[]> {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not configured");
  }
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const params = new URLSearchParams({
    select: "*",
    detected_at: `gte.${since}`,
    order: "detected_at.desc",
    limit: "1000",
  });
  const res = await fetch(`${url}/rest/v1/signals?${params}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as SignalRow[];
}

function formatCstShort(iso: string): string {
  const dt = new Date(iso);
  const cst = new Date(dt.getTime() + 8 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(cst.getUTCHours())}:${pad(cst.getUTCMinutes())}`;
}

function formatCstNow(): string {
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${cst.getUTCFullYear()}-${pad(cst.getUTCMonth() + 1)}-${pad(cst.getUTCDate())} ${pad(
    cst.getUTCHours(),
  )}:${pad(cst.getUTCMinutes())} CST`;
}

function formatMonthDayCst(): string {
  const cst = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(cst.getUTCMonth() + 1)}-${pad(cst.getUTCDate())}`;
}

function renderHtml(signals: SignalRow[]): string {
  // Aggregate by source
  const bySrc = new Map<string, SignalRow[]>();
  for (const s of signals) {
    const arr = bySrc.get(s.source) ?? [];
    arr.push(s);
    bySrc.set(s.source, arr);
  }
  const sortedSources = [...bySrc.entries()].sort((a, b) => b[1].length - a[1].length);

  const rowsHtml = sortedSources
    .map(([src, items]) => {
      const meta = SOURCE_LABELS[src] ?? { emoji: "•", label: src };
      return (
        '<tr>' +
        `<td style="padding:8px 12px;font-size:14px;color:#cbd5e1;">${meta.emoji} ${meta.label}</td>` +
        `<td style="padding:8px 12px;font-size:14px;color:#f8fafc;font-weight:600;text-align:right;">${items.length}</td>` +
        '</tr>'
      );
    })
    .join("");

  const topLines = signals
    .slice(0, 15)
    .map((s) => {
      const meta = SOURCE_LABELS[s.source] ?? { emoji: "•", label: s.source };
      const chg = Number(s.chg_pct) || 0;
      const sign = chg >= 0 ? "+" : "";
      const symbol = s.symbol ?? s.inst_id.replace("-USDT-SWAP", "");
      const color = chg >= 0 ? "#34d399" : "#f87171";
      const ts = formatCstShort(s.detected_at);
      return (
        '<tr>' +
        `<td style="padding:6px 12px;font-family:ui-monospace,monospace;font-size:13px;color:#f1f5f9;">${symbol}</td>` +
        `<td style="padding:6px 12px;font-size:12px;color:#94a3b8;">${meta.emoji}</td>` +
        `<td style="padding:6px 12px;font-family:ui-monospace,monospace;font-size:13px;color:${color};text-align:right;">${sign}${chg.toFixed(
          2,
        )}%</td>` +
        `<td style="padding:6px 12px;font-size:12px;color:#64748b;text-align:right;">${ts}</td>` +
        '</tr>'
      );
    })
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:12px;overflow:hidden;">
    <div style="padding:24px;border-bottom:1px solid #262626;">
      <h1 style="margin:0;color:#fafafa;font-size:20px;">⚡ OKX Pump Monitor · 24h 汇总</h1>
      <p style="margin:6px 0 0;color:#94a3b8;font-size:13px;">${formatCstNow()} · 共 ${signals.length} 个信号</p>
    </div>

    <div style="padding:20px 24px;">
      <h2 style="margin:0 0 12px;color:#e5e5e5;font-size:14px;font-weight:600;">📊 按维度分布</h2>
      <table style="width:100%;border-collapse:collapse;background:#0f0f0f;border-radius:8px;overflow:hidden;">
        ${rowsHtml || '<tr><td style="padding:16px;color:#737373;text-align:center;">本日全市场平静</td></tr>'}
      </table>
    </div>

    <div style="padding:0 24px 24px;">
      <h2 style="margin:0 0 12px;color:#e5e5e5;font-size:14px;font-weight:600;">🔥 Top 15 最新信号</h2>
      <table style="width:100%;border-collapse:collapse;background:#0f0f0f;border-radius:8px;overflow:hidden;">
        ${topLines || '<tr><td style="padding:16px;color:#737373;text-align:center;">无</td></tr>'}
      </table>
    </div>

    <div style="padding:16px 24px;border-top:1px solid #262626;background:#0a0a0a;">
      <a href="https://okx-pump-monitor.vercel.app/" style="display:inline-block;background:#10b981;color:#0a0a0a;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:13px;font-weight:600;">查看 Dashboard →</a>
    </div>
  </div>
</body></html>`;
}

interface ResendResponse {
  id?: string;
  message?: string;
}

async function sendViaResend(
  html: string,
  signalCount: number,
): Promise<{ ok: boolean; status: number; resend_id?: string; body: string }> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const to = process.env.DIGEST_TO_EMAIL ?? "";
  const from = process.env.DIGEST_FROM_EMAIL ?? "";
  if (!apiKey || !to || !from) {
    return {
      ok: false,
      status: 0,
      body: "RESEND_API_KEY / DIGEST_TO_EMAIL / DIGEST_FROM_EMAIL not fully configured",
    };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `OKX Pump Monitor · ${formatMonthDayCst()} · ${signalCount} 个信号`,
      html,
    }),
  });
  const text = await res.text();
  let parsed: ResendResponse | null = null;
  try {
    parsed = JSON.parse(text) as ResendResponse;
  } catch {
    // non-JSON body
  }
  return {
    ok: res.ok,
    status: res.status,
    resend_id: parsed?.id,
    body: text.slice(0, 300),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();
  if (!authorized(req)) {
    console.warn("[digest] unauthorized request");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const signals = await fetch24hSignals();
    console.log(`[digest] fetched ${signals.length} signals from last 24h`);
    const html = renderHtml(signals);
    const send = await sendViaResend(html, signals.length);
    const elapsedMs = Date.now() - t0;
    if (send.ok) {
      console.log(
        `[digest] sent ${signals.length} signals · resend_id=${send.resend_id ?? "?"} elapsed=${elapsedMs}ms`,
      );
    } else {
      console.error(
        `[digest] send FAILED status=${send.status} body=${send.body} elapsed=${elapsedMs}ms`,
      );
    }
    return NextResponse.json({
      signals_count: signals.length,
      send,
      elapsed_ms: elapsedMs,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`[digest] error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
