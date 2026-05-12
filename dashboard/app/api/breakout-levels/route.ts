import { NextResponse } from "next/server";

import {
  insertBreakoutLevel,
  listBreakoutLevels,
  type BreakoutLevelRow,
} from "@/lib/supabase-admin";
import { validateAndNormalize } from "@/lib/okx-validate";

export const dynamic = "force-dynamic";

interface PostBody {
  symbol?: string;
  level_price?: number | string;
  direction?: "above" | "below";
  label?: string;
}

export async function GET(): Promise<
  NextResponse<BreakoutLevelRow[] | { error: string }>
> {
  try {
    const rows = await listBreakoutLevels();
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/breakout-levels GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
): Promise<NextResponse<BreakoutLevelRow | { error: string }>> {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.symbol || !body.level_price || !body.direction) {
    return NextResponse.json(
      { error: "Missing required fields: symbol, level_price, direction" },
      { status: 400 },
    );
  }
  if (body.direction !== "above" && body.direction !== "below") {
    return NextResponse.json(
      { error: "direction must be 'above' or 'below'" },
      { status: 400 },
    );
  }
  const price = Number(body.level_price);
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json(
      { error: "level_price must be a positive number" },
      { status: 400 },
    );
  }

  try {
    const { symbol, inst_id } = await validateAndNormalize(body.symbol);
    const inserted = await insertBreakoutLevel({
      symbol,
      inst_id,
      level_price: price,
      direction: body.direction,
      label: body.label ?? null,
    });
    return NextResponse.json(inserted, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("23505")) {
      return NextResponse.json(
        { error: "This exact level (symbol + price + direction) already exists" },
        { status: 409 },
      );
    }
    const userErr =
      message.includes("Invalid symbol") || message.includes("not a live OKX");
    if (!userErr) console.error("[api/breakout-levels POST]", message);
    return NextResponse.json(
      { error: message },
      { status: userErr ? 400 : 500 },
    );
  }
}
