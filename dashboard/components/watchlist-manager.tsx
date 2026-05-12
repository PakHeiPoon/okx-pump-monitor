"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface WatchlistRow {
  symbol: string;
  inst_id: string;
  pump_threshold_override: number | null;
  dump_threshold_override: number | null;
  note: string | null;
  added_at: string;
}

interface ApiError {
  error: string;
}

async function fetchWatchlist(): Promise<WatchlistRow[]> {
  const res = await fetch("/api/watchlist", { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as WatchlistRow[];
}

async function addSymbol(symbol: string): Promise<WatchlistRow> {
  const res = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as WatchlistRow;
}

async function deleteSymbol(symbol: string): Promise<void> {
  const res = await fetch(`/api/watchlist/${encodeURIComponent(symbol)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export function WatchlistManager() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WatchlistRow[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  async function refresh(): Promise<void> {
    try {
      const rows = await fetchWatchlist();
      setItems(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Load watchlist failed: ${msg}`);
    }
  }

  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open]);

  async function handleAdd(): Promise<void> {
    const symbol = input.trim();
    if (!symbol) return;
    setLoading(true);
    try {
      const row = await addSymbol(symbol);
      setItems((prev) => [row, ...prev]);
      setInput("");
      toast.success(`Added ${row.symbol} (${row.inst_id})`);
      startTransition(() => {
        // hint Next.js to revalidate the home page so signals on next cron
        // surface immediately from this new symbol.
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(symbol: string): Promise<void> {
    try {
      await deleteSymbol(symbol);
      setItems((prev) => prev.filter((r) => r.symbol !== symbol));
      toast.success(`Removed ${symbol}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(msg);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
      >
        <Eye className="h-4 w-4" />
        Watchlist
        {items.length > 0 ? (
          <span className="bg-primary/15 text-primary ml-1 rounded-full px-1.5 py-0.5 font-mono text-[10px]">
            {items.length}
          </span>
        ) : null}
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[420px] flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-border border-b p-6">
          <SheetTitle>Watchlist · Personal monitor</SheetTitle>
          <SheetDescription>
            Coins added here are scanned every 15min on the same ±3%/±5%
            thresholds — independent of the TOP50 universe.
          </SheetDescription>
        </SheetHeader>

        <div className="border-border flex gap-2 border-b p-6">
          <Input
            placeholder="PENGU"
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleAdd();
              }
            }}
            disabled={loading}
            autoFocus
            className="font-mono uppercase"
          />
          <Button
            onClick={() => void handleAdd()}
            disabled={loading || !input.trim()}
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="text-muted-foreground py-10 text-center text-sm">
              No coins yet. Add one above — type{" "}
              <span className="text-foreground font-mono">PENGU</span>,{" "}
              <span className="text-foreground font-mono">TRUMP</span> …
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((row) => (
                <li
                  key={row.symbol}
                  className="border-border hover:bg-accent/40 flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="font-mono text-sm font-semibold">
                      {row.symbol}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {row.inst_id}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleDelete(row.symbol)}
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
