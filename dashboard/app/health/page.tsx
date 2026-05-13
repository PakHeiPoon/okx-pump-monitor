import { HeartPulse } from "lucide-react";

import { RoutePlaceholder } from "@/components/route-placeholder";

export const metadata = {
  title: "Health · OKX Pump Monitor",
};

export default function HealthPage() {
  return (
    <RoutePlaceholder
      icon={HeartPulse}
      title="System Health"
      tagline="Scanner 心跳 / 数据通道 / 通知投递率"
      description="实时呈现整套监控系统的运行状态。当 scanner 没按时跑、Supabase 写入失败、飞书/邮件投递失败时第一时间发现，而不是几小时后用户察觉无消息才知道。"
      upcoming={[
        {
          label: "Scanner 心跳监控",
          detail:
            "展示最近 N 次 scanner run 的开始时间、耗时、信号数量、失败率。超过 30 分钟没心跳自动告警。",
          eta: "Tier 1",
        },
        {
          label: "数据通道延迟",
          detail:
            "OKX API / Supabase 写入 / Resend 邮件发送的 p50/p95 延迟时序图。",
          eta: "Tier 1",
        },
        {
          label: "通知投递率",
          detail:
            "过去 24h 飞书 webhook / 邮件 / 浏览器 push 的成功率，失败原因聚合。",
          eta: "Tier 1",
        },
        {
          label: "GH Actions 运行历史",
          detail: "嵌入 scan.yml / daily-digest.yml 的最近 50 次 run 状态。",
          eta: "Tier 1",
        },
      ]}
      backendDeps={[
        "scanner_heartbeat (supabase)",
        "watchdog workflow",
        "/api/health",
      ]}
    />
  );
}
