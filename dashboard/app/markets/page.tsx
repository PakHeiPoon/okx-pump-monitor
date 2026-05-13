import { TrendingUp } from "lucide-react";

import { RoutePlaceholder } from "@/components/route-placeholder";

export const metadata = {
  title: "Markets · OKX Pump Monitor",
};

export default function MarketsPage() {
  return (
    <RoutePlaceholder
      icon={TrendingUp}
      title="Markets"
      tagline="跨所价差 / 爆仓流 / 资金费率全市场"
      description="单交易所的拉升往往是噪音，三所同时异动才是真信号。这个页面把市场宏观面集中起来，帮助你识别套利机会和验证信号真实性。"
      upcoming={[
        {
          label: "实时爆仓流（Liquidation Stream）",
          detail:
            "OKX 公共爆仓接口 + 简单事件聚合：5 分钟内强平累计 ≥ $1M 自动高亮。爆仓往往领先爆拉/闪崩 1-5 分钟。",
          eta: "Tier 1",
        },
        {
          label: "跨所价差矩阵",
          detail:
            "OKX / Binance / Bybit 三所 swap 价格 vs 现货价格的实时差。差距 ≥ 0.3% 触发套利信号。",
          eta: "Tier 1",
        },
        {
          label: "全市场资金费率热力图",
          detail:
            "USDT-SWAP 所有合约的当前 funding rate 排序，正/负极端按色温呈现。",
          eta: "Tier 1",
        },
        {
          label: "OI / Volume / Funding 三维气泡图",
          detail:
            "x=OI 变化%, y=价格变化%, 气泡大小=成交额。一眼看出哪些币在「主动建仓」哪些在「被动跟随」。",
          eta: "Tier 2",
        },
      ]}
      backendDeps={[
        "liquidations monitor",
        "cross_exchange_spread monitor",
        "OKX /public/liquidation-orders",
        "Binance /fapi",
        "Bybit /v5/market",
      ]}
    />
  );
}
