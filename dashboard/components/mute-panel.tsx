"use client";

/**
 * Mute 控制面板 (V2.24)。
 *
 * 替代飞书 @bot 命令 —— 因为企业 admin 没启用应用导致 callback 路径死了，
 * mute 现在改成 dashboard 上点按钮。Secret 本地 localStorage 存，免反复输入。
 */
import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface MuteState {
  muted_until: string | null;
  muted_at: string | null;
  muted_by: string | null;
  reason: string | null;
  updated_at: string | null;
}

const PRESETS: Array<{ label: string; minutes: number }> = [
  { label: "30 min", minutes: 30 },
  { label: "1 h", minutes: 60 },
  { label: "2 h", minutes: 120 },
  { label: "4 h", minutes: 240 },
  { label: "12 h", minutes: 720 },
  { label: "24 h", minutes: 1440 },
];

const SECRET_KEY = "okx-mute-secret";

function formatCst(iso: string): string {
  const dt = new Date(iso);
  const cst = new Date(dt.getTime() + 8 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(cst.getUTCMonth() + 1)}-${pad(cst.getUTCDate())} ${pad(cst.getUTCHours())}:${pad(cst.getUTCMinutes())}`;
}

function isActive(s: MuteState | null): boolean {
  if (!s?.muted_until) return false;
  return new Date(s.muted_until) > new Date();
}

export function MutePanel(): React.JSX.Element {
  const [state, setState] = useState<MuteState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [secret, setSecret] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // 初始：localStorage 取 secret + 拉 state
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(SECRET_KEY) ?? "";
      setSecret(saved);
    }
    void refresh();
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/mute", { cache: "no-store" });
      if (!r.ok) throw new Error(`GET /api/mute → ${r.status}`);
      const data = (await r.json()) as MuteState | null;
      setState(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const call = useCallback(
    async (action: "mute" | "unmute", minutes?: number, label?: string) => {
      const secretToUse = secret.trim();
      if (!secretToUse) {
        setError("请先填写并保存 mute secret");
        return;
      }
      setBusy(label ?? action);
      setError(null);
      try {
        const r = await fetch("/api/mute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Mute-Secret": secretToUse,
          },
          body: JSON.stringify({ action, minutes }),
        });
        if (!r.ok) {
          const txt = await r.text();
          throw new Error(`${r.status}: ${txt.slice(0, 200)}`);
        }
        const data = (await r.json()) as { ok: boolean; state: MuteState };
        setState(data.state);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "request failed");
      } finally {
        setBusy(null);
      }
    },
    [secret],
  );

  const saveSecret = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SECRET_KEY, secret.trim());
      setError(null);
    }
  }, [secret]);

  const active = isActive(state);
  const minsLeft = state?.muted_until
    ? Math.max(0, Math.round((new Date(state.muted_until).getTime() - Date.now()) / 60_000))
    : 0;

  return (
    <div className="bg-card border-border rounded-lg border p-5 space-y-4">
      {/* Header + 当前状态 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="bg-accent/50 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
            {active ? (
              <BellOff className="text-rose-400 h-5 w-5" />
            ) : (
              <Bell className="text-emerald-400 h-5 w-5" />
            )}
          </div>
          <div>
            <h3 className="text-foreground text-base font-semibold">飞书推送 Mute</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              暂停推送但 cron + 回测继续跑；到期自动恢复
            </p>
          </div>
        </div>
        {loading ? (
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        ) : active ? (
          <Badge
            variant="outline"
            className="border-rose-500/40 bg-rose-500/10 text-rose-300"
          >
            🔇 静音中 · {minsLeft}min · 至 {formatCst(state!.muted_until!)} CST
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          >
            ✅ 活跃
          </Badge>
        )}
      </div>

      {/* Secret 输入 */}
      <div className="flex items-center gap-2">
        <input
          type="password"
          placeholder="MUTE_SECRET (一次输入，本地保存)"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="bg-background border-border focus:border-primary flex-1 rounded-md border px-3 py-1.5 font-mono text-xs outline-none"
        />
        <Button size="sm" variant="outline" onClick={saveSecret} disabled={!secret.trim()}>
          保存
        </Button>
      </div>

      {/* 预设按钮 */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.minutes}
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => call("mute", p.minutes, p.label)}
          >
            {busy === p.label ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              `🔇 ${p.label}`
            )}
          </Button>
        ))}
        <Button
          size="sm"
          variant="default"
          disabled={busy !== null || !active}
          onClick={() => call("unmute", undefined, "unmute")}
        >
          {busy === "unmute" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "✅ 取消静音"
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "刷新"}
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      ) : null}

      {/* 当前 mute 详细信息 */}
      {state && active ? (
        <div className="text-muted-foreground border-t border-border pt-3 text-xs space-y-0.5">
          <div>by: <span className="text-foreground font-mono">{state.muted_by ?? "?"}</span></div>
          <div>reason: <span className="text-foreground font-mono">{state.reason ?? "?"}</span></div>
          {state.updated_at ? (
            <div>updated: <span className="text-foreground font-mono">{formatCst(state.updated_at)} CST</span></div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
