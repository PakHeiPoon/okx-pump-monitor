import { NextResponse } from "next/server";

import {
  insertWatchlistEntry,
  listWatchlist,
  type WatchlistRow,
} from "@/lib/supabase-admin";
import { validateAndNormalize } from "@/lib/okx-validate";

export const dynamic = "force-dynamic";

interface PostBody {
  symbol?: string;
  note?: string;
}

export async function GET(): Promise<NextResponse<WatchlistRow[] | { error: string }>> {
  try {
    const rows = await listWatchlist();
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/watchlist GET] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
): Promise<NextResponse<WatchlistRow | { error: string }>> {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.symbol || typeof body.symbol !== "string") {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  try {
    const { symbol, inst_id } = await validateAndNormalize(body.symbol);
    const inserted = await insertWatchlistEntry({
      symbol,
      inst_id,
      note: body.note,
    });
    return NextResponse.json(inserted, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // 23505 = unique violation (symbol already exists in watchlist)
    if (message.includes("23505")) {
      return NextResponse.json(
        { error: "Symbol is already on the watchlist" },
        { status: 409 },
      );
    }
    const looksLikeUserError =
      message.includes("Invalid symbol") || message.includes("not a live OKX");
    if (!looksLikeUserError) {
      console.error("[api/watchlist POST] failed:", message);
    }
    return NextResponse.json(
      { error: message },
      { status: looksLikeUserError ? 400 : 500 },
    );
  }
}
