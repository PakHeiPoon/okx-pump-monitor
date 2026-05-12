import { NextResponse } from "next/server";

import { deleteWatchlistEntry } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ symbol: string }>;
}

export async function DELETE(
  _req: Request,
  { params }: RouteParams,
): Promise<NextResponse<{ ok: true } | { error: string }>> {
  const { symbol } = await params;
  const cleaned = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,15}$/.test(cleaned)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }
  try {
    await deleteWatchlistEntry(cleaned);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[api/watchlist/${cleaned} DELETE] failed:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
