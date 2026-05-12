"""New Listings Monitor —— OKX 新上架永续合约首日提醒。

底层逻辑：拉 OKX 全部 live SWAP 合约 inst_id 集合，跟 state.json
里上次保存的集合做 diff。新增的就是新上架。一次性告警（添加到 set 后下次
就不再告警），不依赖 cooldown。

state.json 里用 "_known_swap_inst_ids" 作为存储 key（state.prune_expired
跳过 '_' 开头的 key，不会被清掉）。
"""
import time

from .base import Monitor, Signal
from .. import okx


KNOWN_KEY = "_known_swap_inst_ids"


class NewListingsMonitor(Monitor):
    name = "new_listings"

    def __init__(self, config, state):
        self.config = config
        self.state = state    # 引用 state dict，scan 完会被 state.save() 落盘

    def scan(self):
        try:
            current = okx.fetch_all_swap_inst_ids()
        except Exception as e:
            print(f"  [new_listings] 拉合约列表失败: {e}")
            return []
        previous = set(self.state.get(KNOWN_KEY) or [])
        if not previous:
            # 首次跑——baseline，无告警
            self.state[KNOWN_KEY] = sorted(current)
            print(f"  [new_listings] baseline 建立: {len(current)} 个合约")
            return []
        new_ones = current - previous
        signals = []
        now_ms = int(time.time() * 1000)
        for inst in sorted(new_ones):
            # 新上架——拉 last price 作为信号 close
            try:
                last_price = okx.fetch_last_price(inst) or 0
            except Exception:
                last_price = 0
            signals.append(
                Signal(
                    inst_id=inst,
                    direction="pump",  # 新上架 = 机会
                    chg_pct=0.0,
                    vol_usdt=0,
                    bars=0,
                    open_price=last_price,
                    close_price=last_price,
                    bar_ts_ms=now_ms,
                    source=self.name,
                    meta={
                        "first_seen": True,
                        "last_price": last_price,
                    },
                ),
            )
        # 更新 baseline（已下架的也跟着 forget）
        self.state[KNOWN_KEY] = sorted(current)
        if new_ones:
            print(f"  [new_listings] 发现 {len(new_ones)} 个新合约: {', '.join(sorted(new_ones))}")
        return signals
