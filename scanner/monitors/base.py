"""Monitor 抽象基类。"""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class Signal:
    """统一的信号 DTO，跨 monitor 通用。"""
    inst_id: str
    direction: str          # 'pump' | 'dump'
    chg_pct: float
    vol_usdt: float
    bars: int
    open_price: float
    close_price: float
    bar_ts_ms: int
    source: str             # monitor name


class Monitor(ABC):
    name: str = "base"

    @abstractmethod
    def scan(self):
        """返回 list[Signal]。一次完整扫描周期。"""
        raise NotImplementedError
