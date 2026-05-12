export interface Signal {
  id: number;
  inst_id: string;
  symbol: string;
  direction: "pump" | "dump";
  chg_pct: number;
  vol_usdt: number;
  bars: number;
  open_price: number;
  close_price: number;
  bar_ts: string;
  detected_at: string;
  source: string;
}

export interface StatsBundle {
  signals_24h: number;
  pumps_24h: number;
  dumps_24h: number;
  total_vol_usdt: number;
  avg_pump_pct: number;
  avg_dump_pct: number;
  top_coin?: { symbol: string; hits: number };
}

export type TimeWindow = "1h" | "6h" | "24h" | "7d";
