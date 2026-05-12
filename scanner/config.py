"""集中加载 env 配置。所有 env vars 在此处声明，避免散落各处。"""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    # OKX 扫描参数
    top_n: int
    pump_threshold: float
    dump_threshold: float
    min_vol_usdt: float
    lookback_bars: int
    cooldown_min: int

    # V2.0 新 monitor 阈值
    vol_surge_multiplier: float    # 当前 bar vol > 最近 N 根均值 × 该倍数
    vol_surge_window: int           # 看最近多少根 1m K 线算均值
    vol_surge_max_abs_chg_pct: float  # 价格波动 < 该值时才算"放量但没涨"
    funding_threshold_pct: float    # |funding rate| >= 该值（%）触发
    funding_top_n: int              # 只看 TOP N 大盘合约的资金费率，控制 API 量

    # V2.6 新 monitor 阈值
    perp_premium_threshold_pct: float   # |swap-spot| / spot * 100 >= 触发
    longshort_ratio_high: float         # 散户多空账户比 ≥ 该值（极端多）
    longshort_ratio_low: float          # ≤ 该值（极端空）

    # 通知通道
    feishu_webhook: str

    # 持久层（可选——未配置时 graceful skip）
    supabase_url: str
    supabase_service_key: str


def load() -> Config:
    # 兼容老 THRESHOLD：单值时两个方向共用
    legacy = float(os.environ.get("THRESHOLD", "5.0"))
    return Config(
        top_n=int(os.environ.get("TOP_N", "50")),
        pump_threshold=float(os.environ.get("PUMP_THRESHOLD", legacy)),
        dump_threshold=float(os.environ.get("DUMP_THRESHOLD", legacy)),
        min_vol_usdt=float(os.environ.get("MIN_VOL_USDT", "50000")),
        lookback_bars=int(os.environ.get("LOOKBACK_BARS", "16")),
        cooldown_min=int(os.environ.get("COOLDOWN_MIN", "30")),
        # V2.0
        vol_surge_multiplier=float(os.environ.get("VOL_SURGE_MULTIPLIER", "8.0")),
        vol_surge_window=int(os.environ.get("VOL_SURGE_WINDOW", "20")),
        vol_surge_max_abs_chg_pct=float(os.environ.get("VOL_SURGE_MAX_ABS_CHG_PCT", "1.5")),
        funding_threshold_pct=float(os.environ.get("FUNDING_THRESHOLD_PCT", "0.1")),
        funding_top_n=int(os.environ.get("FUNDING_TOP_N", "30")),
        # V2.6
        perp_premium_threshold_pct=float(os.environ.get("PERP_PREMIUM_THRESHOLD_PCT", "0.5")),
        longshort_ratio_high=float(os.environ.get("LONGSHORT_RATIO_HIGH", "3.5")),
        longshort_ratio_low=float(os.environ.get("LONGSHORT_RATIO_LOW", "0.4")),
        feishu_webhook=os.environ["FEISHU_WEBHOOK"],
        supabase_url=os.environ.get("SUPABASE_URL", "").rstrip("/"),
        supabase_service_key=os.environ.get("SUPABASE_SERVICE_KEY", ""),
    )
