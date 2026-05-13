import { Sparkles } from "lucide-react";

import { RoutePlaceholder } from "@/components/route-placeholder";

export const metadata = {
  title: "Social · OKX Pump Monitor",
};

export default function SocialPage() {
  return (
    <RoutePlaceholder
      icon={Sparkles}
      title="Social"
      tagline="Twitter 异动推文 / 新闻情绪"
      description="新闻和大 V 推文常常是 pump 的起点。把社交媒体当作第 11 个 monitor 接进来，配合 LLM 做语义级触发条件（不是关键词匹配）。"
      upcoming={[
        {
          label: "实时异动推文",
          detail:
            "关注的 KOL 列表 + 重要账号（@cz_binance / @SBF_FTX / 项目方），新推 30 秒内推送。语义级过滤 FUD / shilling / 实质性新闻 三类。",
          eta: "Tier 2",
        },
        {
          label: "币种情绪趋势",
          detail:
            "按币种聚合 24h 推文量 + 平均情绪分。突然 5x 提及量 = 隐性 pump 早期信号。",
          eta: "Tier 2",
        },
        {
          label: "新闻聚合 + 触发",
          detail:
            "CoinDesk / The Block / Foresight News 关键词触发：「SEC 通过」「ETF approved」「listing」「partnership」",
          eta: "Tier 2",
        },
        {
          label: "宏观事件日历",
          detail:
            "FOMC / CPI / 非农就业 / 加息决议倒计时。事件前后 15 分钟自动 mute 普通信号，避免假突破。",
          eta: "Tier 3",
        },
      ]}
      backendDeps={[
        "twitter_sentiment monitor",
        "Twitter API v2",
        "LunarCrush API",
        "LLM 语义分类（Claude Haiku）",
      ]}
    />
  );
}
