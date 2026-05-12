import { NextResponse } from "next/server";

import { deleteBreakoutLevel } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(
  _req: Request,
  { params }: RouteParams,
): Promise<NextResponse<{ ok: true } | { error: string }>> {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    await deleteBreakoutLevel(numId);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[api/breakout-levels/${numId} DELETE]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
