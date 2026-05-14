import "server-only";

export interface Heartbeat {
  id: number;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  monitors_run: number;
  signals_found: number;
  fresh_signals: number;
  okx_errors: number;
  meta: Record<string, unknown>;
  created_at: string;
}

function supabaseEnv(): { url: string; key: string } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  // service key 仅 server side
  const key = (process.env.SUPABASE_SERVICE_KEY ?? "").trim();
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY 未配置",
    );
  }
  return { url, key };
}

export async function fetchRecentHeartbeats(limit: number = 30): Promise<Heartbeat[]> {
  const { url, key } = supabaseEnv();
  const params = new URLSearchParams({
    select: "*",
    order: "started_at.desc",
    limit: String(limit),
  });
  const res = await fetch(`${url}/rest/v1/scanner_heartbeat?${params}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    next: { revalidate: 10 },
  });
  if (res.status === 404) {
    // table 未建（migration 没跑过）— 当作空数组
    return [];
  }
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as Heartbeat[];
}
