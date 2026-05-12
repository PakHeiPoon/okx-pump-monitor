// GET /api/signals — JSON endpoint mirroring fetchSignals(). Used by the
// client-side SignalsLive component to poll every 15s without going through
// Server Component RSC. Reads with the public/anon key so this is safe to
// expose. RLS keeps it SELECT-only.
import { NextResponse } from "next/server";

import { fetchSignals } from "@/lib/supabase";
import { SOURCES, type SourceId } from "@/lib/source-meta";
import type { Signal, TimeWindow } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseWindow(v: string | null): TimeWindow {
  return v === "1h" || v === "6h" || v === "7d" ? v : "24h";
}

function parseSources(v: string | null): SourceId[] {
  if (!v) return [];
  const valid = new Set<SourceId>(SOURCES.map((s) => s.id));
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SourceId => valid.has(s as SourceId));
}

function parseDirection(
  v: string | null,
): "pump" | "dump" | "above" | "below" | undefined {
  return v === "pump" || v === "dump" || v === "above" || v === "below"
    ? v
    : undefined;
}

export async function GET(
  req: Request,
): Promise<NextResponse<Signal[] | { error: string }>> {
  const url = new URL(req.url);
  try {
    const signals = await fetchSignals({
      window: parseWindow(url.searchParams.get("window")),
      direction: parseDirection(url.searchParams.get("direction")),
      sources: parseSources(url.searchParams.get("sources")) || undefined,
      limit: 200,
    });
    return NextResponse.json(signals);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/signals GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
