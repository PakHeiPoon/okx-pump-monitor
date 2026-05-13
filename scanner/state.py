"""跨 run cooldown 状态。当前用 state.json，后续 V2 可迁 Supabase。

V2.8: 冷却 key 从单一 inst_id 升级为 (inst_id, direction, source) 三元组。
解决"BILL pump 后 30 分钟内 BILL dump 也被冷却"和"同一币不同 monitor
互相挤掉"两个老问题。

格式：'BILL-USDT-SWAP|pump|swap_top_gainers'

向后兼容：老格式 key 不带 '|'，在 prune_expired 里也会自然过期，无需迁移。
"""
import json
import time

STATE_FILE = "state.json"


def load():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def prune_expired(state, cooldown_min):
    """清掉过期 cooldown 记录，返回剩余 state。
    以 '_' 开头的 key 是 monitor 自留地（如 _known_inst_ids），跳过 pruning。"""
    now = time.time()
    out = {}
    for k, v in state.items():
        if k.startswith("_"):
            out[k] = v  # reserved key — 保留原值不动
            continue
        if isinstance(v, (int, float)) and now - v < cooldown_min * 60:
            out[k] = v
    return out


def make_cooldown_key(signal) -> str:
    """从 Signal 对象生成冷却 key。

    粒度：(inst_id, direction, source) 三元组。
    - BILL-USDT-SWAP pump on swap_top_gainers   → 'BILL-USDT-SWAP|pump|swap_top_gainers'
    - BILL-USDT-SWAP dump on swap_top_gainers   → 'BILL-USDT-SWAP|dump|swap_top_gainers' (独立 key)
    - BILL-USDT-SWAP pump on oi_surge           → 'BILL-USDT-SWAP|pump|oi_surge'         (独立 key)

    这样同一币种不同方向、不同 monitor 各自独立冷却，互不干扰。
    """
    return f"{signal.inst_id}|{signal.direction}|{signal.source}"
