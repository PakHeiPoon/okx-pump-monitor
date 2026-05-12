// Centralised source display metadata. Used by signal table, filter sidebar,
// breakout/alert managers — single source of truth so labels/colors stay
// consistent everywhere.

export type SourceId =
  | "swap_top_gainers"
  | "watchlist"
  | "volume_surge"
  | "funding_extreme"
  | "breakout"
  | "price_alert"
  | "oi_surge";

export interface SourceMeta {
  id: SourceId;
  label: string;
  shortLabel: string;     // For compact display in table chip
  emoji: string;
  description: string;
  badgeClass: string;     // Tailwind classes for the source badge
}

export const SOURCES: SourceMeta[] = [
  {
    id: "swap_top_gainers",
    label: "TOP50 gainers · 15m 拉升/闪崩",
    shortLabel: "TOP50",
    emoji: "🚀",
    description: "OKX 24h 涨幅榜 TOP50 内任一币种 15 分钟累计变动越界。",
    badgeClass: "bg-orange-500/15 text-orange-300 hover:bg-orange-500/25",
  },
  {
    id: "watchlist",
    label: "Watchlist · 自选盯盘",
    shortLabel: "Watch",
    emoji: "🎯",
    description: "你手动添加的币种，不受 TOP50 限制。",
    badgeClass: "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25",
  },
  {
    id: "volume_surge",
    label: "Volume surge · 放量但价格稳",
    shortLabel: "VolSurge",
    emoji: "📊",
    description: "成交量 > 最近 20 根均值 × N 倍，但价格波动 < 1.5%。",
    badgeClass: "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25",
  },
  {
    id: "funding_extreme",
    label: "Funding extreme · 资金费率极端",
    shortLabel: "Funding",
    emoji: "💰",
    description: "永续合约资金费率 ≥ +0.1% 或 ≤ -0.1%（多空挤压）。",
    badgeClass: "bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/25",
  },
  {
    id: "breakout",
    label: "Breakout · 突破前高/前低",
    shortLabel: "Breakout",
    emoji: "⚡",
    description: "你手动设置的关键价位被突破时触发。",
    badgeClass: "bg-fuchsia-500/15 text-fuchsia-300 hover:bg-fuchsia-500/25",
  },
  {
    id: "price_alert",
    label: "Price alert · 目标价/止损价",
    shortLabel: "Alert",
    emoji: "🔔",
    description: "你设置的目标价或止损价被触达，一次性告警。",
    badgeClass: "bg-teal-500/15 text-teal-300 hover:bg-teal-500/25",
  },
  {
    id: "oi_surge",
    label: "OI surge · 持仓量异动",
    shortLabel: "OI",
    emoji: "📈",
    description: "持仓量 OI 短时变化 ≥ ±10%（主力建/平仓的痕迹）。",
    badgeClass: "bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25",
  },
];

const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

export function getSourceMeta(id: string): SourceMeta {
  return (
    SOURCE_BY_ID.get(id as SourceId) ?? {
      id: id as SourceId,
      label: id,
      shortLabel: id.slice(0, 8),
      emoji: "•",
      description: "",
      badgeClass: "bg-zinc-500/15 text-zinc-300",
    }
  );
}
