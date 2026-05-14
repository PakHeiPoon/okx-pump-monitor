# OKX Pump Monitor

> 多维度信号雷达：扫 OKX 永续合约 + 链上 + 社交 + 强平，融合打分，**实时告警**，**回测验证**。云端跑、无服务器、单兵开发友好。

[![scan.yml](https://github.com/PakHeiPoon/okx-pump-monitor/actions/workflows/scan.yml/badge.svg)](https://github.com/PakHeiPoon/okx-pump-monitor/actions/workflows/scan.yml)
[![scan-realtime.yml](https://github.com/PakHeiPoon/okx-pump-monitor/actions/workflows/scan-realtime.yml/badge.svg)](https://github.com/PakHeiPoon/okx-pump-monitor/actions/workflows/scan-realtime.yml)
[![watchdog.yml](https://github.com/PakHeiPoon/okx-pump-monitor/actions/workflows/watchdog.yml/badge.svg)](https://github.com/PakHeiPoon/okx-pump-monitor/actions/workflows/watchdog.yml)

Dashboard：<https://okx-pump-monitor.vercel.app>

---

## 项目定位

不是「自动下单交易机器人」。是一个**告警雷达**：14+ 个独立 monitor 并发扫 OKX U 本位永续 + Etherscan 链上 + CoinGecko 热搜 + Google News，命中阈值时融合打分推送到 Feishu，**用户自己看上下文做决策**。

> **For**: 主动交易者，需要在 5-15min 内被第一时间告知"市场发生了什么"，且想要一份带新闻 catalyst 的判断材料。
> **Not for**: 想要全托管自动下单的人（请看 [Markfans/cryptoquant-ai](https://github.com/Markfans/cryptoquant-ai)）。

---

## 顶层架构

```
┌──── Data Sources (no paid keys required) ──────────────────────┐
│  OKX REST  ·  Bitget  ·  Gate.io  ·  Etherscan V2 (free)       │
│  CoinGecko (free)  ·  Google News RSS (free)                   │
└─────────────────────┬──────────────────────────────────────────┘
                      ▼
┌──── GitHub Actions cron ───────────────────────────────────────┐
│  scan.yml          */15 min   13 monitors (主管道)              │
│  scan-realtime.yml */5  min   1 monitor (flush_reversal)        │
│  watchdog.yml      */10 min   thin scheduler → Vercel route     │
└─────────────────────┬──────────────────────────────────────────┘
                      ▼
            ┌────────────────────┐
            │ scanner.fusion     │   ←  按 (inst_id, time_bucket) 分组
            │  confidence 1-5★   │       同币多源命中 → 高置信卡
            └─────────┬──────────┘
                      ▼
┌──── Persistence + Notification ────────────────────────────────┐
│  Supabase: signals / scanner_heartbeat / liquidations / oi /…  │
│  Feishu webhook (实时高置信卡)                                  │
│  Resend daily digest (Vercel cron daily)                       │
└─────────────────────┬──────────────────────────────────────────┘
                      ▼
┌──── Dashboard (Vercel · Next.js 16) ───────────────────────────┐
│  /          主信号流（cards/table 切换 · fusion grouping）       │
│  /markets   爆仓流 + 跨所价差                                    │
│  /onchain   Whale → CEX 大额转账                                │
│  /social    热搜 + Google News catalyst                         │
│  /backtest  Simple replay + Walk-forward sweep                  │
│  /health    Scanner 心跳 + 错误率                                │
│  /settings  Watchlist / Breakout / Price alerts (preview)       │
└────────────────────────────────────────────────────────────────┘
```

---

## 14+1 Monitors

### Main scanner (`scan.yml` · `*/15 min`)

| Source | 中文 | 触发条件 | API |
|---|---|---|---|
| `swap_top_gainers` | 🚀 TOP 15min 拉升/闪崩 | 1m K 滚动 16 根累计 \|chg\| ≥ pump/dump 阈值 | OKX candles |
| `watchlist` | 🎯 自选盯盘 | 同上但只看用户自选币（per-coin 阈值 override） | OKX + Supabase |
| `volume_surge` | 📊 放量但价格稳 | vol ≥ 20 根均值 × N 且 \|chg\| < 1.5% | OKX candles |
| `funding_extreme` | 💰 资金费率极端 | \|funding rate\| ≥ 0.1% | OKX funding-rate |
| `breakout` | ⚡ 突破前高/前低 | 用户预设关键价位被首次穿越 | OKX ticker + Supabase |
| `price_alert` | 🔔 目标价/止损价 | 用户预设的 target/stop 价位触达（一次性） | OKX ticker + Supabase |
| `oi_surge` | 📈 持仓量异动 | OI 短时变化 ≥ ±10%（建/平仓痕迹） | OKX open-interest |
| `perp_premium` | 💱 合约/现货价差 | \|swap − spot\| / spot ≥ 0.5% | OKX ticker × 2 |
| `new_listings` | 🆕 新上架合约 | OKX 新出现的 USDT-SWAP 首次发现 | OKX instruments |
| `longshort_ratio` | ⚖️ 散户多空比极端 | retail L/S ratio ≥ 3.5 或 ≤ 0.4（反向指标） | OKX rubik |
| `liquidations` | 💀 强平爆仓密集 | 单 inst 5min 累计 ≥ $1M 强平 | OKX liquidation-orders |
| `whale_to_cex` | 🐋 鲸鱼转入 CEX | USDT/USDC 大额转入 8 家 CEX 热钱包（≥ $500K 单笔 OR ≥ $5M 累计） | Etherscan V2 |
| `social_surge` | 🌐 社交热搜异动 | 首次进入 CoinGecko 24h 热搜 + 自动抓 2 条 Google News catalyst | CoinGecko + Google News |
| ~~`cross_exchange`~~ | 🔀 跨所价差（**已禁用** V2.15） | 文件保留，重启 2 行 | Bitget + Gate.io |

### Realtime scanner (`scan-realtime.yml` · `*/5 min`)

| Source | 中文 | 触发条件 |
|---|---|---|
| `flush_reversal` | 🪂 闪崩 V 反弹（trap & reverse） | 近 30min 创局部新高 → ≤15min 闪崩 ≥ 8% → V-bottom 反弹 ≥ 30% + vol ≥ baseline × 3 |

---

## 信号融合层 (V2.9+)

同一币种在同一轮扫描里被**多个 monitor** 同时命中 → 自动合并为一张高置信卡片：

```
🔥 高置信共振 · 3 组
  ★★★☆☆  LAB-USDT-SWAP  (3 维度同时触发)
    swap_top_gainers · oi_surge · social_surge
    +4.15% vol 8.6M USDT  📰 [CoinCentral] Gensyn Launches Delphi…
```

每条 raw signal 仍单独持久化到 supabase（backtest 用），不会丢数据；通知层只看 primary。

---

## 回测系统

### Simple replay
```bash
python -m scanner.backtest --since 2026-05-01 --monitor swap_top_gainers --horizon-min 15
```
对每条历史 signal，拉 detected_at 之后 N 分钟的 OKX 1m K 线，算真实回报 → 按 source / confidence 聚合。

### Walk-forward sweep (V2.16+)
Dashboard `/backtest?mode=walkforward`：
- 滚动窗口 7d（可调），前 70% 训练找最优阈值 → 后 30% 测试验证 OOS
- 输出 4 KPI：OK windows / 平均最优阈值 / **阈值稳定性 σ** / **平均 OOS 回报**
- σ 小 + OOS 正回报 = 这个 monitor 的真实可用阈值

灵感借鉴自 [Markfans/cryptoquant-ai](https://github.com/Markfans/cryptoquant-ai) 的 walkForwardBacktest.ts。

---

## 部署指南

### 1. Supabase

1. 注册 <https://supabase.com>，建项目
2. SQL Editor 依次粘贴执行：
   - `supabase/schema.sql`
   - `supabase/v2_migration.sql`
   - `supabase/v25_migration.sql`
   - `supabase/v28_migration.sql`
3. 抓 `Project URL` 和 `service_role key`、`anon key`

### 2. Vercel

```bash
git clone https://github.com/<你>/okx-pump-monitor.git
cd okx-pump-monitor
vercel link --project okx-pump-monitor   # 把 dashboard/ 当 root dir
```

Project Settings → Environment Variables 配置：

| Key | 来源 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | Dashboard 客户端 + cron route |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key | Dashboard 客户端读 |
| `SUPABASE_SERVICE_KEY` | Supabase service key | Cron route 写库 |
| `FEISHU_WEBHOOK` | 飞书自定义机器人 | 实时告警 + watchdog 红色卡 |
| `RESEND_API_KEY` | <https://resend.com> 免费 | daily digest 邮件 |
| `DIGEST_TO_EMAIL` | 你的收件邮箱 | daily digest 收件人 |
| `DIGEST_FROM_EMAIL` | Resend verified domain 或 `onboarding@resend.dev` | daily digest 发件人 |
| `CRON_SECRET` | 随机 32-byte hex（`openssl rand -hex 32`） | Vercel cron + GH watchdog 共用鉴权 |

### 3. GitHub Actions

```bash
gh secret set FEISHU_WEBHOOK
gh secret set SUPABASE_URL                # 注意：scanner 用这个 key 而不是 NEXT_PUBLIC_ 版本
gh secret set SUPABASE_SERVICE_KEY
gh secret set CRON_SECRET                  # 与 Vercel 同值
gh secret set RESEND_API_KEY               # 备用，未来 Python digest 兜底
gh secret set DIGEST_TO_EMAIL
gh secret set DIGEST_FROM_EMAIL
gh secret set ETHERSCAN_KEY                # whale_to_cex 必需，免费 100k/day
gh secret set LUNARCRUSH_KEY               # 占位，未来升级用（当前 social_surge 用 CoinGecko 免费）
```

Push 后 GH Actions 会自动开始 cron。第一轮可手动触发：
```bash
gh workflow run scan.yml
gh workflow run scan-realtime.yml
```

---

## 调参（环境变量）

均通过 `.github/workflows/scan.yml` 或 `scan-realtime.yml` 的 `env:` 配置：

### 主扫描阈值
```yaml
TOP_N: '50'                    # 主 universe top by 24h chg
PUMP_THRESHOLD: '3.0'          # 16-bar 累计涨幅触发
DUMP_THRESHOLD: '5.0'          # 16-bar 累计跌幅触发
MIN_VOL_USDT: '50000'          # 触发最小成交额
LOOKBACK_BARS: '16'            # 滚动窗口 bars 数
COOLDOWN_MIN: '30'             # 单 (inst, dir, source) 冷却分钟
```

### 各 monitor 独立阈值
```yaml
VOL_SURGE_MULTIPLIER: '8.0'
VOL_SURGE_MAX_ABS_CHG_PCT: '1.5'
FUNDING_THRESHOLD_PCT: '0.1'
PERP_PREMIUM_THRESHOLD_PCT: '0.5'
LONGSHORT_RATIO_HIGH: '3.5'
LONGSHORT_RATIO_LOW: '0.4'
LIQ_NOTIONAL_THRESHOLD: '1000000'   # 强平触发 $1M
LIQ_WINDOW_MIN: '5'
LIQ_TOP_N: '30'
WHALE_SINGLE_TX_MIN_USD: '500000'
WHALE_CUMULATIVE_MIN_USD: '5000000'
WHALE_WINDOW_MIN: '15'
FLUSH_LOOKBACK_MIN: '30'
FLUSH_MIN_DROP_PCT: '8.0'
FLUSH_PEAK_TROUGH_MAX_MIN: '15'
FLUSH_MIN_RECOVERY_PCT: '30.0'
FLUSH_VOL_MULTIPLIER: '3.0'
FLUSH_REQUIRE_24H_GAINER_PCT: '5.0'
SOCIAL_ENRICH_NEWS: '1'             # 1=抓 Google News，0=关闭省 HTTP
SOCIAL_REQUIRE_OKX_SWAP: '1'        # 只对 OKX 有合约的发信号
```

---

## 本地开发

```bash
# Python scanner
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 跑一次完整扫描（需要 env）
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… FEISHU_WEBHOOK=… \
  ETHERSCAN_KEY=… \
  python -m scanner.main

# 只跑 realtime
python -m scanner.realtime

# 跑 backtest CLI
python -m scanner.backtest --since 2026-05-01 --csv /tmp/bt.csv
```

```bash
# Dashboard
cd dashboard
pnpm install
pnpm dev                # http://localhost:3000

# 部署到 Vercel
vercel --prod
```

---

## 项目结构

```
.
├── scanner/                         # Python 扫描主逻辑
│   ├── main.py                      # 13-monitor 主入口（15min cron）
│   ├── realtime.py                  # flush_reversal 入口（5min cron）
│   ├── config.py
│   ├── state.py                     # cooldown 三元组 key (V2.8+)
│   ├── fusion.py                    # 多源融合 + confidence (V2.9+)
│   ├── okx.py                       # OKX REST 封装
│   ├── exchanges.py                 # Bitget + Gate.io helpers (cross_exchange)
│   ├── monitors/                    # 14 个 monitor 实现
│   │   ├── base.py
│   │   ├── swap_top_gainers.py
│   │   ├── watchlist.py
│   │   ├── volume_surge.py
│   │   ├── funding_extreme.py
│   │   ├── breakout.py
│   │   ├── price_alert.py
│   │   ├── oi_surge.py
│   │   ├── perp_premium.py
│   │   ├── new_listings.py
│   │   ├── longshort_ratio.py
│   │   ├── liquidations.py
│   │   ├── cross_exchange.py        # 文件保留，scanner.main 已注释 (V2.15)
│   │   ├── whale_to_cex.py
│   │   ├── social_surge.py          # + Google News RSS 富化 (V2.17)
│   │   └── flush_reversal.py
│   ├── notifiers/
│   │   └── feishu.py                # 卡片渲染 + 颜色 + fusion-aware
│   ├── storage/
│   │   └── supabase_client.py
│   └── backtest/
│       ├── __main__.py              # CLI: replay + agg
│       └── replay.py
├── dashboard/                       # Next.js 16 dashboard
│   ├── app/
│   │   ├── page.tsx                 # 主信号流
│   │   ├── markets/page.tsx
│   │   ├── onchain/page.tsx
│   │   ├── social/page.tsx
│   │   ├── backtest/page.tsx        # simple + walk-forward
│   │   ├── health/page.tsx
│   │   ├── settings/page.tsx
│   │   └── api/cron/
│   │       ├── watchdog/route.ts    # 由 GH Actions thin scheduler 触发
│   │       └── daily-digest/route.ts # Vercel native cron daily
│   ├── components/
│   │   ├── signal-card.tsx          # 主卡片，含 fusion + news catalyst
│   │   ├── signals-table.tsx
│   │   ├── top-nav.tsx
│   │   └── …
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── fusion.ts                # client-side fusion grouping
│   │   ├── backtest.ts              # WF engine + agg
│   │   └── heartbeat.ts
│   └── vercel.json                  # crons config
├── .github/workflows/
│   ├── scan.yml                     # */15 main pipeline
│   ├── scan-realtime.yml            # */5 flush_reversal
│   └── watchdog.yml                 # */10 → ping Vercel route
├── supabase/
│   ├── schema.sql
│   ├── v2_migration.sql
│   ├── v25_migration.sql
│   └── v28_migration.sql            # scanner_heartbeat + liquidations
└── state.json                       # cooldown 状态（GH Actions 提交回 repo）
```

---

## 版本路线图

| Ver | 主要改动 |
|---|---|
| V1 | scan.py 单文件 + Feishu webhook（仅 swap_top_gainers） |
| V2.0 | 重构为 scanner 包 + 多 monitor + Supabase + dashboard MVP |
| V2.5 | OI surge monitor + oi_snapshots 表 |
| V2.6 | perp_premium + longshort_ratio |
| V2.7 | Resend daily digest（先 Python，后迁 Vercel cron） |
| V2.8 | scanner_heartbeat + watchdog + liquidations + cross_exchange + 冷却三元组 key |
| V2.9 | 信号融合层 + confidence 评分 |
| V2.10 | flush_reversal monitor + 独立 5min realtime workflow |
| V2.11 | whale_to_cex (Etherscan) + social_surge (CoinGecko) |
| V2.12 | Dashboard `/onchain` `/social` 真数据可视化 |
| V2.13 | Dashboard `/markets` `/health` 真数据 |
| V2.14 | Dashboard `/backtest` simple replay UI |
| V2.15 | cross_exchange 关闭（不匹配用户交易风格） |
| V2.16 | Walk-forward backtest engine + UI |
| V2.17 | social_surge + Google News RSS catalyst |

### 待办（按 ROI 排序）

- [ ] Zhipu GLM 决策层（需 `ZHIPU_API_KEY`）：给高置信信号写一句中文决策建议
- [ ] FRED 宏观 mute 窗口：CPI/FOMC 前 24h 自动降级告警
- [ ] /settings 把 Watchlist/Breakout/PriceAlert manager 迁离首页 header
- [ ] state.json → Supabase 表（解锁 Vercel Pro 时 scan.yml 整体迁 Vercel cron）
- [ ] Walk-forward 扩展到 volume_surge / oi_surge 等 monitor 自己的关键超参
- [ ] WebSocket 常驻 monitor（终极态实时，需要 Fluid Compute 或 VM）

---

## API 使用 & 成本

| API | 免费层够用？ | 用途 |
|---|---|---|
| OKX REST | ✅ 公开数据无限 | 90% 数据 |
| Bitget USDT-FUTURES | ✅ 无 key 无限 | cross_exchange（已禁用） |
| Gate.io perp | ✅ 无 key 无限 | cross_exchange（已禁用） |
| Etherscan V2 | ✅ 100k req/day | whale_to_cex（~2300 req/day 占 2.3%） |
| CoinGecko `/search/trending` | ✅ 无 key 无限 | social_surge 主数据 |
| Google News RSS | ✅ 无 key 但偶尔限流 | social_surge 新闻富化 |
| Supabase | ✅ free tier 500MB | 全部持久化 |
| Vercel | ✅ Hobby 包含日 1 个 cron | dashboard + daily-digest |
| GH Actions | ✅ Public repo 无限 minutes | scan.yml + scan-realtime + watchdog |
| Resend | ✅ 100 emails/day | daily digest |
| Feishu webhook | ✅ 无限 | 实时告警 |

**总成本 = $0/月**（前提：repo 设为 Public + Vercel Hobby）。

---

## License

MIT — 用于个人研究和自有账户操作。**不是投资建议**。任何信号都建议在真实下单前结合多维度判断。

## Disclaimer

加密货币市场高度波动。本工具的所有信号 / 阈值 / 回测 / news enrichment 都是**辅助判断**，不构成任何买卖建议。维护者不对任何使用本工具产生的盈亏负责。
