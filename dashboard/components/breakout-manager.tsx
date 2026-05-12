"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface BreakoutLevelRow {
  id: number;
  symbol: string;
  inst_id: string;
  level_price: number;
  direction: "above" | "below";
  label: string | null;
  enabled: boolean;
  last_triggered_at: string | null;
}

interface ApiError {
  error: string;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function BreakoutManager() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BreakoutLevelRow[]>([]);
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh(): Promise<void> {
    try {
      const rows = await jsonFetch<BreakoutLevelRow[]>("/api/breakout-levels");
      setItems(rows);
    } catch (err: unknown) {
      toast.error(`Load levels failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  async function handleAdd(): Promise<void> {
    if (!symbol.trim() || !price.trim()) {
      toast.error("Symbol and price are required");
      return;
    }
    setLoading(true);
    try {
      const row = await jsonFetch<BreakoutLevelRow>("/api/breakout-levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.trim(),
          level_price: Number(price),
          direction,
          label: label.trim() || undefined,
        }),
      });
      setItems((prev) => [row, ...prev]);
      setSymbol("");
      setPrice("");
      setLabel("");
      toast.success(`Added ${row.symbol} ${direction} ${row.level_price}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: number): Promise<void> {
    try {
      await jsonFetch(`/api/breakout-levels/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((r) => r.id !== id));
      toast.success("Level removed");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unknown error");
    }
  }

  const activeCount = items.filter((r) => r.enabled).length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
      >
        <Zap className="h-4 w-4" />
        Breakout
        {activeCount > 0 ? (
          <span className="bg-fuchsia-500/20 text-fuchsia-300 ml-1 rounded-full px-1.5 py-0.5 font-mono text-[10px]">
            {activeCount}
          </span>
        ) : null}
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[420px] flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-border border-b p-6">
          <SheetTitle>Breakout levels · 突破前高/前低</SheetTitle>
          <SheetDescription>
            Set psychological / chart price levels. Scanner alerts when the latest
            price crosses any enabled level. 24h cooldown per level.
          </SheetDescription>
        </SheetHeader>

        <div className="border-border space-y-3 border-b p-6">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="bo-symbol" className="text-xs">Symbol</Label>
              <Input
                id="bo-symbol"
                placeholder="BTC"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                disabled={loading}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bo-price" className="text-xs">Level price</Label>
              <Input
                id="bo-price"
                type="number"
                step="any"
                placeholder="70000"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={loading}
                className="font-mono"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Direction</Label>
            <div className="flex gap-2">
              {(["above", "below"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    direction === d
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  {d === "above" ? "↑ Above" : "↓ Below"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bo-label" className="text-xs">Label (optional)</Label>
            <Input
              id="bo-label"
              placeholder="心理价位 70k"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={loading}
            />
          </div>
          <Button
            onClick={() => void handleAdd()}
            disabled={loading || !symbol.trim() || !price.trim()}
            className="w-full gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add level
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="text-muted-foreground py-10 text-center text-sm">
              No levels yet. Try {" "}
              <span className="text-foreground font-mono">BTC above 70000</span>.
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((row) => (
                <li
                  key={row.id}
                  className="border-border hover:bg-accent/40 flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-sm">
                      <span className="font-semibold">{row.symbol}</span>
                      <span className="text-muted-foreground"> · {row.direction === "above" ? "↑" : "↓"} </span>
                      <span className="text-foreground">{row.level_price}</span>
                    </span>
                    {row.label ? (
                      <span className="text-muted-foreground text-[11px]">{row.label}</span>
                    ) : null}
                    {row.last_triggered_at ? (
                      <span className="text-amber-400/80 text-[11px]">
                        last triggered: {new Date(row.last_triggered_at).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleDelete(row.id)}
                    className="text-muted-foreground hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
