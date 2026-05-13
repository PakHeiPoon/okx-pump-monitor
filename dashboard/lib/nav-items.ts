import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Coins,
  FlaskConical,
  HeartPulse,
  Settings,
  Sparkles,
  TrendingUp,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  // status:
  //   "live"     — fully wired
  //   "preview"  — placeholder UI, backend wiring pending
  status: "live" | "preview";
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/",
    label: "Signals",
    icon: Activity,
    description: "实时信号流（主战场）",
    status: "live",
  },
  {
    href: "/markets",
    label: "Markets",
    icon: TrendingUp,
    description: "跨所价差 / 爆仓流 / 资金费率全市场",
    status: "preview",
  },
  {
    href: "/onchain",
    label: "Onchain",
    icon: Coins,
    description: "Whale 大额转账 + DEX vs CEX 资金流",
    status: "preview",
  },
  {
    href: "/social",
    label: "Social",
    icon: Sparkles,
    description: "Twitter 异动推文 / 新闻情绪",
    status: "preview",
  },
  {
    href: "/backtest",
    label: "Backtest",
    icon: FlaskConical,
    description: "回测工作台：选 monitor + 时间段 → PnL 曲线",
    status: "preview",
  },
  {
    href: "/health",
    label: "Health",
    icon: HeartPulse,
    description: "Scanner 心跳 / Supabase / 飞书 / 邮件投递率",
    status: "preview",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    description: "Watchlist / Breakout / Price alerts / 通道路由",
    status: "preview",
  },
] as const;

export function isLiveRoute(href: string): boolean {
  return NAV_ITEMS.find((i) => i.href === href)?.status === "live";
}
