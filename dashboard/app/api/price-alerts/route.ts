import { NextResponse } from "next/server";

import {
  insertPriceAlert,
  listPriceAlerts,
  type PriceAlertRow,
} from "@/lib/supabase-admin";
import { fetchLastPrice, validateAndNormalize } from "@/lib/okx-validate";

export const dynamic = "force-dynamic";

interface PostBody {
  symbol?: string;
  target_price?: number | string;
  alert_type?: "target" | "stop_loss" | "custom";
  direction?: "above" | "below";
  note?: string;
}

export async function GET(): Promise<
  NextResponse<PriceAlertRow[] | { error: string }>
> {
  try {
    const rows = await listPriceAlerts();
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/price-alerts GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
): Promise<NextResponse<PriceAlertRow | { error: string }>> {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.symbol || !body.target_price || !body.alert_type) {
    return NextResponse.json(
      { error: "Missing required fields: symbol, target_price, alert_type" },
      { status: 400 },
    );
  }
  const price = Number(body.target_price);
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json(
      { error: "target_price must be a positive number" },
      { status: 400 },
    );
  }
  if (!["target", "stop_loss", "custom"].includes(body.alert_type)) {
    return NextResponse.json(
      { error: "alert_type must be 'target', 'stop_loss', or 'custom'" },
      { status: 400 },
    );
  }

  try {
    const { symbol, inst_id } = await validateAndNormalize(body.symbol);
    // Auto-infer direction by comparing target to current price when not given
    let direction: "above" | "below";
    if (body.direction === "above" || body.direction === "below") {
      direction = body.direction;
    } else {
      const current = await fetchLastPrice(inst_id);
      direction = price >= current ? "above" : "below";
    }
    const inserted = await insertPriceAlert({
      symbol,
      inst_id,
      target_price: price,
      alert_type: body.alert_type,
      direction,
      note: body.note ?? null,
    });
    return NextResponse.json(inserted, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const userErr =
      message.includes("Invalid symbol") || message.includes("not a live OKX");
    if (!userErr) console.error("[api/price-alerts POST]", message);
    return NextResponse.json(
      { error: message },
      { status: userErr ? 400 : 500 },
    );
  }
}
