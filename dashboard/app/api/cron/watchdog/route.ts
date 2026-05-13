/**
 * Vercel Cron Job: Scanner Watchdog
 *
 * Schedule: every 10 minutes (configured in dashboard/vercel.json).
 *
 * 底层逻辑：scanner.main 每次跑完写一行 scanner_heartbeat。这个 cron
 * 读取最新一行，根据 started_at 距今多久判定状态：
 *   < 20 min  → OK     (返回 200，不发告警)
 *   20-30 min → DEGRADED  (一次 cron 延迟，发橙色)
 *   > 30 min  → DOWN      (连续两次漏跑，发红色)
 *
 * Auth: Vercel Cron 会带 `Authorization: Bearer ${CRON_SECRET}`。
 * CRON_SECRET 必须在 Vercel Project Settings → Environment Variables 配置。
 */
import { NextRequest, NextResponse } from "next/server";

// 必须 Node runtime（Edge 不能跑 supabase service-role + Feishu webhook 都可以但保持一致）
export const runtime = "nodejs";
// 禁止缓存：每次 cron 调用都是独立的 freshness check
export const dynamic = "force-dynamic";

const THRESHOLD_DEGRADED_MIN = 20;
const THRESHOLD_DOWN_MIN = 30;

interface Heartbeat {
  started_at: string;
  finished_at: string;
  duration_ms: number;
  monitors_run: number;
  signals_found: number;
  fresh_signals: number;
  okx_errors: number;
  meta?: Record<string, unknown>;
}

function authorized(req: NextRequest): boolean {
  // Vercel Cron sends `Authorization: Bearer ${process.env.CRON_SECRET}`.
  // Local /manual hits can also use the same secret.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — refuse all calls to prevent accidental open endpoint.
    return false;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

async function fetchLatestHeartbeat(): Promise<Heartbeat | null> {
  // 复用 dashboard 已经配置的 NEXT_PUBLIC_SUPABASE_URL（同一个 supabase 项目），
  // 避免维护两份相同的 URL env。SERVICE_KEY 是独立 secret，必须 server-side only。
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY not configured");
  }
  const params = new URLSearchParams({
    select: "*",
    order: "started_at.desc",
    limit: "1",
  });
  const res = await fetch(`${url}/rest/v1/scanner_heartbeat?${params}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    cache: "no-store",
  });
  if (res.status === 404) {
    throw new Error(
      "scanner_heartbeat table missing — run supabase/v28_migration.sql in Supabase SQL Editor",
    );
  }
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  }
  const rows = (await res.json()) as Heartbeat[];
  return rows[0] ?? null;
}

interface FeishuCard {
  msg_type: "interactive";
  card: {
    config: { wide_screen_mode: true };
    header: {
      template: "red" | "orange" | "yellow" | "green";
      title: { tag: "plain_text"; content: string };
    };
    elements: Array<
      | { tag: "markdown"; content: string }
      | {
          tag: "action";
          actions: Array<{
            tag: "button";
            text: { tag: "plain_text"; content: string };
            type: "primary";
            url: string;
          }>;
        }
    >;
  };
}

async function sendFeishu(
  title: string,
  content: string,
  color: "red" | "orange" | "yellow",
): Promise<{ ok: boolean; status: number; body: string }> {
  const webhook = process.env.FEISHU_WEBHOOK ?? "";
  if (!webhook) {
    return { ok: false, status: 0, body: "FEISHU_WEBHOOK not configured" };
  }
  const body: FeishuCard = {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: color,
        title: { tag: "plain_text", content: title },
      },
      elements: [
        { tag: "markdown", content },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: { tag: "plain_text", content: "查看 /health" },
              type: "primary",
              url: "https://okx-pump-monitor.vercel.app/health",
            },
          ],
        },
      ],
    },
  };
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 200) };
}

function formatCstTime(iso: string): string {
  // Supabase returns ISO with +00:00; convert to CST (UTC+8)
  const dt = new Date(iso);
  const cst = new Date(dt.getTime() + 8 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${cst.getUTCFullYear()}-${pad(cst.getUTCMonth() + 1)}-${pad(cst.getUTCDate())} ${pad(
    cst.getUTCHours(),
  )}:${pad(cst.getUTCMinutes())}:${pad(cst.getUTCSeconds())}`;
}

interface WatchdogResult {
  status: "ok" | "degraded" | "down" | "no-heartbeat" | "error";
  age_min?: number;
  heartbeat?: Heartbeat;
  alert_sent?: { ok: boolean; status: number; body: string };
  error?: string;
}

async function runWatchdog(): Promise<WatchdogResult> {
  let hb: Heartbeat | null;
  try {
    hb = await fetchLatestHeartbeat();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { status: "error", error: message };
  }

  if (!hb) {
    const alert = await sendFeishu(
      "⚠️ Scanner 从未启动",
      [
        "`scanner_heartbeat` 表为空。可能原因：",
        "1. V2.8 migration 未执行（跑 `supabase/v28_migration.sql`）",
        "2. scanner 从未成功跑过（手动 trigger `scan.yml`）",
      ].join("\n\n"),
      "orange",
    );
    return { status: "no-heartbeat", alert_sent: alert };
  }

  const startedAt = new Date(hb.started_at);
  const ageMs = Date.now() - startedAt.getTime();
  const ageMin = ageMs / 60_000;

  if (ageMin < THRESHOLD_DEGRADED_MIN) {
    return { status: "ok", age_min: ageMin, heartbeat: hb };
  }

  const startedCst = formatCstTime(hb.started_at);
  const detailLines = [
    `**最近一次 heartbeat**: ${startedCst} CST`,
    `**距今**: ${Math.floor(ageMin)} 分钟前`,
    `**Monitors 启用**: ${hb.monitors_run}`,
    `**信号总数**: ${hb.signals_found}`,
    `**通知数量**: ${hb.fresh_signals}`,
    `**OKX 错误**: ${hb.okx_errors}`,
  ];

  if (ageMin >= THRESHOLD_DOWN_MIN) {
    detailLines.push(
      "",
      "**可能原因**: GitHub Actions 配额耗尽 / scanner workflow 报错 / OKX API 全面不通。",
      "**Action**: 看 https://github.com/PakHeiPoon/okx-pump-monitor/actions",
    );
    const alert = await sendFeishu(
      `🔴 Scanner DOWN · ${Math.floor(ageMin)} 分钟未心跳`,
      detailLines.join("\n"),
      "red",
    );
    return { status: "down", age_min: ageMin, heartbeat: hb, alert_sent: alert };
  }

  // degraded
  detailLines.push(
    "",
    "**说明**: 偶发一次 cron 延迟，下一轮应该恢复。连续 2 次会升级到 DOWN。",
  );
  const alert = await sendFeishu(
    `🟡 Scanner DEGRADED · 上次 ${Math.floor(ageMin)} 分钟前`,
    detailLines.join("\n"),
    "orange",
  );
  return { status: "degraded", age_min: ageMin, heartbeat: hb, alert_sent: alert };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();
  if (!authorized(req)) {
    console.warn(
      "[watchdog] unauthorized request from",
      req.headers.get("x-forwarded-for") ?? "unknown",
    );
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  console.log("[watchdog] tick");
  const result = await runWatchdog();
  const elapsedMs = Date.now() - t0;
  if (result.status === "ok") {
    console.log(`[watchdog] ok age=${result.age_min?.toFixed(1)}min elapsed=${elapsedMs}ms`);
  } else if (result.status === "error") {
    console.error(`[watchdog] error: ${result.error} elapsed=${elapsedMs}ms`);
  } else {
    console.warn(
      `[watchdog] status=${result.status} age=${result.age_min?.toFixed(1)}min ` +
        `alert_ok=${result.alert_sent?.ok ?? "n/a"} elapsed=${elapsedMs}ms`,
    );
  }
  return NextResponse.json(result);
}
