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
    """清掉过期记录，返回剩余 state。"""
    now = time.time()
    return {k: v for k, v in state.items() if now - v < cooldown_min * 60}
