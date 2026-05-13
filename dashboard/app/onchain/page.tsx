import { Coins } from "lucide-react";

import { RoutePlaceholder } from "@/components/route-placeholder";

export const metadata = {
  title: "Onchain · OKX Pump Monitor",
};

export default function OnchainPage() {
  return (
    <RoutePlaceholder
      icon={Coins}
      title="Onchain"
      tagline="Whale 大额转账 + DEX vs CEX 资金流"
      description="链上数据往往领先 CEX 价格 5-30 分钟。大额钱包转入交易所 = 砸盘信号，转出 = 囤币信号。Smart money 经常先在 DEX 建仓后才反映到 CEX。"
      upcoming={[
        {
          label: "Whale 大额转账提醒",
          detail:
            "ETH / BTC / 主流 ERC-20 单笔 ≥ $500K 转账，区分「转入 CEX」「转出 CEX」「钱包间转移」三种性质。",
          eta: "Tier 2",
        },
        {
          label: "稳定币 mint / burn 监控",
          detail: "USDT / USDC 增发或销毁 ≥ $50M。增发常对应市场流动性注入。",
          eta: "Tier 2",
        },
        {
          label: "DEX vs CEX 资金流向",
          detail:
            "对每个热门币种，对比 Uniswap/PancakeSwap 24h 净流入 vs OKX/Binance 净流入。背离信号往往领先价格。",
          eta: "Tier 3",
        },
        {
          label: "代币解锁日历",
          detail:
            "未来 7 天大额代币解锁事件，金额 ≥ $5M 高亮。解锁前后 24h 通常有抛压。",
          eta: "Tier 2",
        },
      ]}
      backendDeps={[
        "whale_alert monitor",
        "Whale Alert API",
        "Etherscan API",
        "TokenUnlocks API",
      ]}
    />
  );
}
