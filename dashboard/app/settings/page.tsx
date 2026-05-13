import { Settings } from "lucide-react";

import { RoutePlaceholder } from "@/components/route-placeholder";

export const metadata = {
  title: "Settings · OKX Pump Monitor",
};

export default function SettingsPage() {
  return (
    <RoutePlaceholder
      icon={Settings}
      title="Settings"
      tagline="Watchlist / Breakout / Price alerts / 通道路由"
      description="把目前散落在首页 header 的 Watchlist / Breakout / PriceAlert manager 集中管理，再加上通知通道偏好（高置信走 push / 中走飞书 / 低只入库）和币种黑名单。"
      upcoming={[
        {
          label: "通知通道分级路由",
          detail:
            "按信号融合分（1-5 ★）决定推送目标：5★ → 浏览器 push + 声音；3-4★ → 飞书；1-2★ → 只写库。",
          eta: "Tier 2",
        },
        {
          label: "Watchlist / Breakout / PriceAlert（迁移）",
          detail:
            "把现在首页 header 上的 3 个 manager 迁到这里，首页只保留盯盘场景。",
          eta: "Tier 1",
        },
        {
          label: "币种黑名单 + 降权",
          detail:
            "新上架币种 24h 内自动降权（防 pump-and-dump），meme 垃圾币加入永久黑名单。",
          eta: "Tier 3",
        },
        {
          label: "宏观事件 mute 窗口",
          detail:
            "FOMC / CPI 等高波动事件前后 15 分钟自动屏蔽普通信号，只保留高置信。",
          eta: "Tier 3",
        },
      ]}
      backendDeps={[
        "user_preferences 表（新建）",
        "通道路由层",
      ]}
    />
  );
}
