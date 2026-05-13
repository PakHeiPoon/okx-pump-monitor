"""Backtest framework — 把过去 N 天 Supabase 里的 signals 重新跑一遍，
统计每个 monitor 的命中后表现：

- 命中率（precision）：信号方向正确（pump 后 15min 真涨 / dump 后真跌）占比
- 平均后 15min 涨跌幅
- 假设按信号开仓的累计 PnL（无杠杆、无手续费 baseline）
- ROC-friendly：可以按 chg_pct 区间分桶，看不同阈值下表现

使用：
    python -m scanner.backtest --since 2026-04-15 --monitor swap_top_gainers
    python -m scanner.backtest --since 2026-05-01 --monitor all --csv /tmp/bt.csv

环境变量（必需）：
    SUPABASE_URL / SUPABASE_SERVICE_KEY  — 拉历史 signals
（OKX K线为公共数据，不需要鉴权）
"""
