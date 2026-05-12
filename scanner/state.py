"""跨 run cooldown 状态。当前用 state.json，后续 V2 可迁 Supabase。"""
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
