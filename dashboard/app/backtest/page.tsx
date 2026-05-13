import { FlaskConical } from "lucide-react";

import { RoutePlaceholder } from "@/components/route-placeholder";

export const metadata = {
  title: "Backtest · OKX Pump Monitor",
};

export default function BacktestPage() {
  return (
    <RoutePlaceholder
      icon={FlaskConical}
      title="Backtest Lab"
      tagline="选 monitor + 时间段 → 跑回测 → 看 PnL / Precision / Recall"
      description="目前所有阈值都是拍脑袋设的，调一个都不知道是变好还是变坏。回测框架把过去 30 天 Supabase 里的 signals 重新跑一遍，每个 monitor 给出准确率、召回率、假设按信号开仓的虚拟 PnL。改阈值之前先回测——避免改坏。"
      upcoming={[
        {
          label: "单 monitor 回测",
          detail:
            "选定 monitor + 阈值 + 时间段，回放历史 signals。输出：触发次数 / 平均后 15min 涨幅 / 胜率 / 假设 1u 开仓的累计 PnL。",
          eta: "Tier 2",
        },
        {
          label: "阈值扫描（grid search）",
          detail:
            "给定阈值范围（如 pump 2.5%-5%），自动扫描 20 个点，画出 PnL vs threshold 曲线，找最优解。",
          eta: "Tier 2",
        },
        {
          label: "A/B 阈值实时对比",
          detail:
            "同时跑 N 套配置（influencer 模式），实盘运行 7 天后对比 PnL 决定主参数。",
          eta: "Tier 3",
        },
        {
          label: "信号融合权重训练",
          detail:
            "用过去 30 天数据训练「同币多 monitor 触发」的最佳融合权重（线性回归 / XGBoost）。",
          eta: "Tier 3",
        },
      ]}
      backendDeps={[
        "scanner/backtest/* (新模块)",
        "Supabase signals 表（历史数据）",
        "OKX K线 history API",
      ]}
    />
  );
}
