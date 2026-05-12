"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Bell, BellOff, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalsTable } from "@/components/signals-table";
import { LiveDot } from "@/components/live-dot";
import { getSourceMeta } from "@/lib/source-meta";
import type { Signal } from "@/lib/types";

interface SignalsLiveProps {
  initialSignals: Signal[];
  queryString: string;     // serialized URLSearchParams.toString()
}

interface ApiError {
  error: string;
}

const POLL_INTERVAL_MS = 15_000;
const SOUND_LS_KEY = "okx_pump_sound";
const NOTIFY_LS_KEY = "okx_pump_notify";

async function fetchSignalsClient(qs: string): Promise<Signal[]> {
  const res = await fetch(`/api/signals?${qs}`, { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as Signal[];
}

function playBeep(direction: "pump" | "dump" | "above" | "below"): void {
  try {
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    // Pump 升调，Dump 降调，方向类信号用中音
    const isPositive = direction === "pump" || direction === "above";
    osc.frequency.setValueAtTime(isPositive ? 880 : 440, ctx.currentTime);
    if (isPositive) {
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.18);
    } else {
      osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.18);
    }
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // ignore
  }
}

function showBrowserNotification(signals: Signal[]): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }
  const top = signals[0];
  const sm = getSourceMeta(top.source);
  const title = signals.length === 1
    ? `${sm.emoji} ${top.symbol} · ${top.direction}`
    : `${sm.emoji} ${signals.length} new signals`;
  const body = signals.length === 1
    ? `${sm.shortLabel} · ${Number(top.chg_pct).toFixed(2)}%`
    : signals.slice(0, 3).map((s) => `${s.symbol} ${s.direction} ${s.chg_pct}%`).join("\n");
  try {
    new Notification(title, { body, icon: "/favicon.ico", tag: "okx-pump" });
  } catch {
    // ignore
  }
}

export function SignalsLive({ initialSignals, queryString }: SignalsLiveProps) {
  const qs = queryString;
  const { data, error, isLoading, mutate } = useSWR(
    ["signals", qs],
    () => fetchSignalsClient(qs),
    {
      fallbackData: initialSignals,
      refreshInterval: POLL_INTERVAL_MS,
      revalidateOnFocus: true,
      keepPreviousData: true,
    },
  );

  const [soundOn, setSoundOn] = useState(false);
  const [notifyOn, setNotifyOn] = useState(false);

  // hydrate prefs from localStorage
  useEffect(() => {
    try {
      setSoundOn(localStorage.getItem(SOUND_LS_KEY) === "1");
      setNotifyOn(localStorage.getItem(NOTIFY_LS_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  function toggleSound(): void {
    const next = !soundOn;
    setSoundOn(next);
    try {
      localStorage.setItem(SOUND_LS_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
    if (next) {
      playBeep("pump"); // confirm beep
      toast.success("Sound alerts on");
    }
  }

  async function toggleNotify(): Promise<void> {
    if (notifyOn) {
      setNotifyOn(false);
      try {
        localStorage.setItem(NOTIFY_LS_KEY, "0");
      } catch {
        // ignore
      }
      return;
    }
    if (typeof Notification === "undefined") {
      toast.error("Browser does not support notifications");
      return;
    }
    if (Notification.permission === "denied") {
      toast.error("Notifications blocked — enable in browser settings");
      return;
    }
    const perm =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (perm === "granted") {
      setNotifyOn(true);
      try {
        localStorage.setItem(NOTIFY_LS_KEY, "1");
      } catch {
        // ignore
      }
      toast.success("Desktop notifications on");
    } else {
      toast.error("Permission denied");
    }
  }

  // Detect new signals: compare top id from prev → current
  const lastTopIdRef = useRef<number>(
    initialSignals[0]?.id ?? 0,
  );
  useEffect(() => {
    if (!data || data.length === 0) return;
    const lastId = lastTopIdRef.current;
    const newOnes = data.filter((s) => s.id > lastId);
    if (newOnes.length > 0 && lastId > 0) {
      // not the first hydration — really new signals
      if (soundOn) {
        playBeep(newOnes[0].direction);
      }
      if (notifyOn) {
        showBrowserNotification(newOnes);
      }
      const sm = getSourceMeta(newOnes[0].source);
      toast(`${sm.emoji} ${newOnes.length} new signal(s)`, {
        description: newOnes
          .slice(0, 3)
          .map((s) => `${s.symbol} ${s.direction} ${s.chg_pct}%`)
          .join(" · "),
      });
    }
    lastTopIdRef.current = data[0].id;
  }, [data, soundOn, notifyOn]);

  const signals = data ?? [];
  const showInitialSkeleton = isLoading && signals.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="text-muted-foreground flex items-center gap-2">
          <LiveDot />
          <span>Auto-refresh every {POLL_INTERVAL_MS / 1000}s</span>
          <span className="text-muted-foreground/60">·</span>
          <span>{signals.length} signals</span>
          {error ? (
            <span className="text-rose-400">· {String(error)}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSound}
            className={soundOn ? "text-emerald-400" : "text-muted-foreground"}
            title={soundOn ? "Sound on (click to mute)" : "Sound off"}
          >
            {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void toggleNotify()}
            className={notifyOn ? "text-emerald-400" : "text-muted-foreground"}
            title={notifyOn ? "Desktop notifications on" : "Desktop notifications off"}
          >
            {notifyOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void mutate()}
            className="text-muted-foreground"
            title="Manual refresh"
          >
            ↻
          </Button>
        </div>
      </div>

      {showInitialSkeleton ? (
        <SignalsSkeleton />
      ) : (
        <SignalsTable signals={signals} />
      )}
    </div>
  );
}

function SignalsSkeleton() {
  return (
    <div className="bg-card border-border rounded-lg border p-4">
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="ml-auto h-4 w-12" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
