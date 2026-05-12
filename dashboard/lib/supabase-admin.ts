// Server-only Supabase REST helper. Uses SUPABASE_SERVICE_KEY (no NEXT_PUBLIC_
// prefix) so the secret is never bundled into the browser. Bypasses RLS.
import "server-only";

function normalizeUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1\/?$/i, "");
}

const SUPABASE_URL = normalizeUrl(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
);
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY ?? "").trim();

function ensureConfigured(): void {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Server Supabase env not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY (Vercel: Project Settings → Environment Variables, Server-side only).",
    );
  }
}

function adminHeaders(extra: HeadersInit = {}): HeadersInit {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export interface WatchlistRow {
  symbol: string;
  inst_id: string;
  pump_threshold_override: number | null;
  dump_threshold_override: number | null;
  note: string | null;
  added_at: string;
}

export async function listWatchlist(): Promise<WatchlistRow[]> {
  ensureConfigured();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/watchlist?select=*&order=added_at.desc`,
    { headers: adminHeaders(), cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`listWatchlist failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as WatchlistRow[];
}

export async function insertWatchlistEntry(row: {
  symbol: string;
  inst_id: string;
  note?: string | null;
}): Promise<WatchlistRow> {
  ensureConfigured();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/watchlist`, {
    method: "POST",
    headers: adminHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify([
      {
        symbol: row.symbol,
        inst_id: row.inst_id,
        note: row.note ?? null,
      },
    ]),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`insertWatchlistEntry failed: ${res.status} ${txt}`);
  }
  const rows = (await res.json()) as WatchlistRow[];
  return rows[0];
}

export async function deleteWatchlistEntry(symbol: string): Promise<void> {
  ensureConfigured();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/watchlist?symbol=eq.${encodeURIComponent(symbol)}`,
    { method: "DELETE", headers: adminHeaders() },
  );
  if (!res.ok) {
    throw new Error(
      `deleteWatchlistEntry failed: ${res.status} ${await res.text()}`,
    );
  }
}
