/**
 * Mute control endpoint (V2.24).
 *
 * 背景：飞书 callback 因为 admin 没启用应用导致 @bot 命令链路不通。
 * 把 mute 控制从飞书 callback 搬到 dashboard，永久绕开 admin 审批依赖。
 *
 *   GET  /api/mute   → 公开读，返回当前 mute_state（status badge 用）
 *   POST /api/mute   → 写，需要 MUTE_SECRET header 校验
 *     body: { action: "mute" | "unmute", minutes?: number }
 *
 * 复用 dashboard/lib/feishu.ts 里的 fetchMuteState / setMuteState，
 * 不重复 Supabase REST 调用细节。
 */
import { NextRequest, NextResponse } from "next/server";

import {
  fetchMuteState,
  setMuteState,
  type MuteState,
} from "@/lib/feishu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireSecret(req: NextRequest): NextResponse | null {
  const expected = (process.env.MUTE_SECRET ?? "").trim();
  if (!expected) {
    return NextResponse.json(
      { error: "MUTE_SECRET not configured on server" },
      { status: 500 },
    );
  }
  const got = req.headers.get("x-mute-secret")?.trim();
  if (got !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(): Promise<NextResponse<MuteState | { error: string } | null>> {
  try {
    const state = await fetchMuteState();
    return NextResponse.json(state);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

interface MutePayload {
  action?: "mute" | "unmute";
  minutes?: number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authErr = requireSecret(req);
  if (authErr) return authErr;

  let body: MutePayload;
  try {
    body = (await req.json()) as MutePayload;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const by = "dashboard";

  if (body.action === "unmute") {
    const ok = await setMuteState(null, "off", by);
    if (!ok) {
      return NextResponse.json({ error: "supabase write failed" }, { status: 500 });
    }
    const state = await fetchMuteState();
    return NextResponse.json({ ok: true, state });
  }

  if (body.action === "mute") {
    const m = Number(body.minutes ?? 30);
    if (!Number.isFinite(m) || m < 1 || m > 60 * 24) {
      return NextResponse.json(
        { error: "minutes must be 1-1440" },
        { status: 400 },
      );
    }
    const minutes = Math.floor(m);
    const until = new Date(Date.now() + minutes * 60_000);
    const reason = minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}min`;
    const ok = await setMuteState(until.toISOString(), reason, by);
    if (!ok) {
      return NextResponse.json({ error: "supabase write failed" }, { status: 500 });
    }
    const state = await fetchMuteState();
    return NextResponse.json({ ok: true, state });
  }

  return NextResponse.json(
    { error: 'action must be "mute" or "unmute"' },
    { status: 400 },
  );
}
