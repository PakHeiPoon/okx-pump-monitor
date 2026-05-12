"""Notifier 抽象基类。"""
from abc import ABC, abstractmethod


class Notifier(ABC):
    name: str = "base"

    @abstractmethod
    def send(self, signals):
        """signals: list[Signal]。发送通知。失败应自行 log 不抛出，避免影响其他通道。"""
        raise NotImplementedError
