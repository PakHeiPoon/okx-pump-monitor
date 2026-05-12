// Validates that a symbol like "PENGU" maps to an existing OKX
// USDT-margined perpetual swap (PENGU-USDT-SWAP). Caches for 1 hour so we
// don't slam the OKX API on every form submission.
import "server-only";

type InstrumentsResponse = {
  code: string;
  msg: string;
  data: Array<{ instId: string; state?: string }>;
};

let cache: { fetched_at: number; instIds: Set<string> } | null = null;
const TTL_MS = 60 * 60 * 1000;

async function getSwapInstIds(): Promise<Set<string>> {
  if (cache && Date.now() - cache.fetched_at < TTL_MS) {
    return cache.instIds;
  }
  const res = await fetch(
    "https://www.okx.com/api/v5/public/instruments?instType=SWAP",
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`OKX instruments fetch failed: ${res.status}`);
  }
  const json = (await res.json()) as InstrumentsResponse;
  if (json.code !== "0") {
    throw new Error(`OKX instruments error: ${json.msg}`);
  }
  const ids = new Set<string>();
  for (const row of json.data) {
    if (row.state === "live" || row.state === undefined) {
      ids.add(row.instId);
    }
  }
  cache = { fetched_at: Date.now(), instIds: ids };
  return ids;
}

export interface NormalizedSymbol {
  symbol: string;    // PENGU
  inst_id: string;   // PENGU-USDT-SWAP
}

export async function validateAndNormalize(
  rawInput: string,
): Promise<NormalizedSymbol> {
  const cleaned = rawInput.trim().toUpperCase();
  if (!cleaned) {
    throw new Error("Symbol cannot be empty");
  }
  // Strip user-pasted suffixes
  const symbol = cleaned
    .replace(/-USDT-SWAP$/, "")
    .replace(/-USDT$/, "")
    .replace(/\s+/g, "");
  if (!/^[A-Z0-9]{1,15}$/.test(symbol)) {
    throw new Error(`Invalid symbol "${rawInput}" — use letters/digits like PENGU`);
  }
  const inst_id = `${symbol}-USDT-SWAP`;
  const allInstIds = await getSwapInstIds();
  if (!allInstIds.has(inst_id)) {
    throw new Error(
      `${inst_id} is not a live OKX USDT-margined perpetual. Check the symbol.`,
    );
  }
  return { symbol, inst_id };
}

// Last-traded price (for direction auto-inference on price alerts).
export async function fetchLastPrice(inst_id: string): Promise<number> {
  const res = await fetch(
    `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(inst_id)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`OKX ticker fetch failed: ${res.status}`);
  const json = (await res.json()) as { code: string; data: Array<{ last: string }> };
  if (json.code !== "0" || !json.data?.[0]?.last) {
    throw new Error(`OKX ticker error for ${inst_id}`);
  }
  return parseFloat(json.data[0].last);
}
