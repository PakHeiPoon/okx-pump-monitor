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
        feishu_webhook=os.environ["FEISHU_WEBHOOK"],
        supabase_url=os.environ.get("SUPABASE_URL", "").rstrip("/"),
        supabase_service_key=os.environ.get("SUPABASE_SERVICE_KEY", ""),
    )
