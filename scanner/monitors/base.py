"""Monitor 抽象基类。"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class Signal:
    """统一的信号 DTO，跨 monitor 通用。

    - direction: 'pump'/'dump' 用于价格类 monitor；'above'/'below' 用于
      breakout / price_alert（突破/价格穿越）。DB CHECK 已放宽支持四值。
    - meta: 每个 monitor 自己的 context（funding_rate / level_price /
      vol_multiplier / target_price / alert_type ...），落 signals.meta JSONB。
    """
    inst_id: str
    direction: str          # 'pump' | 'dump' | 'above' | 'below'
    chg_pct: float
    vol_usdt: float
    bars: int
    open_price: float
    close_price: float
    bar_ts_ms: int
    source: str             # monitor name
    meta: dict = field(default_factory=dict)


class Monitor(ABC):
    name: str = "base"

    @abstractmethod
    def scan(self):
        """返回 list[Signal]。一次完整扫描周期。"""
        raise NotImplementedError
