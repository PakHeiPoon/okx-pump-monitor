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
  | "oi_surge"
  | "perp_premium"
  | "new_listings"
  | "longshort_ratio"
  | "liquidations"
  | "cross_exchange"
  | "flush_reversal"
  | "whale_to_cex"
  | "social_surge";

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
  {
    id: "perp_premium",
    label: "Perp premium · 合约/现货价差",
    shortLabel: "Prem",
    emoji: "💱",
    description: "永续合约相对现货溢价 ≥ ±0.5%（多空狂热反向指标）。",
    badgeClass: "bg-sky-500/15 text-sky-300 hover:bg-sky-500/25",
  },
  {
    id: "new_listings",
    label: "New listings · 新上架合约",
    shortLabel: "NEW",
    emoji: "🆕",
    description: "OKX 新上架的 USDT 永续合约，首次出现就提醒（打新机会）。",
    badgeClass: "bg-lime-500/15 text-lime-300 hover:bg-lime-500/25",
  },
  {
    id: "longshort_ratio",
    label: "Long/Short ratio · 散户多空比极端",
    shortLabel: "L/S",
    emoji: "⚖️",
    description: "散户多空账户比 ≥3.5（FOMO多）或 ≤0.4（FOMO空），反向指标。",
    badgeClass: "bg-violet-500/15 text-violet-300 hover:bg-violet-500/25",
  },
  {
    id: "liquidations",
    label: "Liquidations · 强平爆仓密集",
    shortLabel: "Liq",
    emoji: "💀",
    description: "近 5 分钟单币种累计强平 ≥ $1M。多头爆仓→抛压dump，空头爆仓→轧空pump。",
    badgeClass: "bg-red-500/15 text-red-300 hover:bg-red-500/25",
  },
  {
    id: "cross_exchange",
    label: "Cross-exchange · 跨所价差",
    shortLabel: "Cross",
    emoji: "🔀",
    description: "OKX 相对 Bitget / Gate.io 价差 ≥ 0.3%。OKX 偏高→pump 领先；偏低→dump 滞涨。",
    badgeClass: "bg-purple-500/15 text-purple-300 hover:bg-purple-500/25",
  },
  {
    id: "flush_reversal",
    label: "Flush reversal · 闪崩 V 反弹",
    shortLabel: "Flush",
    emoji: "🪂",
    description: "强势币创新高后 ≤ 15min 闪崩 ≥ 8% 杀多 + V-bottom 反弹（trap & reverse 形态）。",
    badgeClass: "bg-pink-500/15 text-pink-300 hover:bg-pink-500/25",
  },
  {
    id: "whale_to_cex",
    label: "Whale → CEX · 鲸鱼转入交易所",
    shortLabel: "Whale",
    emoji: "🐋",
    description: "USDT/USDC 大额转入 Binance/Coinbase/OKX 等热钱包（单笔 ≥ $500K 或累计 ≥ $5M）= 砸盘预备。",
    badgeClass: "bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25",
  },
  {
    id: "social_surge",
    label: "Social surge · 社交热搜异动",
    shortLabel: "Social",
    emoji: "🌐",
    description: "首次进入 CoinGecko 24h 全球热搜榜（top 15）= 零售注意力突变，常先于 pump 1-3 天。",
    badgeClass: "bg-sky-500/15 text-sky-300 hover:bg-sky-500/25",
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
