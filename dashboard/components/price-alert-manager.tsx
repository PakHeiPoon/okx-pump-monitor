"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Bell } from "lucide-react";
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

type AlertType = "target" | "stop_loss" | "custom";

interface PriceAlertRow {
  id: number;
  symbol: string;
  inst_id: string;
  target_price: number;
  alert_type: AlertType;
  direction: "above" | "below";
  note: string | null;
  enabled: boolean;
  triggered_at: string | null;
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

const ALERT_TYPES: { id: AlertType; label: string }[] = [
  { id: "target", label: "🎯 Target" },
  { id: "stop_loss", label: "🛑 Stop loss" },
  { id: "custom", label: "✍ Custom" },
];

export function PriceAlertManager() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PriceAlertRow[]>([]);
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [alertType, setAlertType] = useState<AlertType>("target");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh(): Promise<void> {
    try {
      const rows = await jsonFetch<PriceAlertRow[]>("/api/price-alerts");
      setItems(rows);
    } catch (err: unknown) {
      toast.error(`Load alerts failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  async function handleAdd(): Promise<void> {
    if (!symbol.trim() || !price.trim()) {
      toast.error("Symbol and target price are required");
      return;
    }
    setLoading(true);
    try {
      const row = await jsonFetch<PriceAlertRow>("/api/price-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.trim(),
          target_price: Number(price),
          alert_type: alertType,
          note: note.trim() || undefined,
          // direction auto-inferred server-side from last price
        }),
      });
      setItems((prev) => [row, ...prev]);
      setSymbol("");
      setPrice("");
      setNote("");
      toast.success(
        `Added ${row.symbol} ${row.alert_type} ${row.direction} ${row.target_price}`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: number): Promise<void> {
    try {
      await jsonFetch(`/api/price-alerts/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((r) => r.id !== id));
      toast.success("Alert removed");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Unknown error");
    }
  }

  const active = items.filter((r) => r.enabled && !r.triggered_at);
  const fired = items.filter((r) => r.triggered_at);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
      >
        <Bell className="h-4 w-4" />
        Alerts
        {active.length > 0 ? (
          <span className="bg-teal-500/20 text-teal-300 ml-1 rounded-full px-1.5 py-0.5 font-mono text-[10px]">
            {active.length}
          </span>
        ) : null}
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[420px] flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-border border-b p-6">
          <SheetTitle>Price alerts · 目标价/止损价</SheetTitle>
          <SheetDescription>
            One-shot price alerts. Direction auto-inferred from current OKX
            price. Triggered alerts stay listed for history.
          </SheetDescription>
        </SheetHeader>

        <div className="border-border space-y-3 border-b p-6">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="pa-symbol" className="text-xs">Symbol</Label>
              <Input
                id="pa-symbol"
                placeholder="PENGU"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                disabled={loading}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pa-price" className="text-xs">Target price</Label>
              <Input
                id="pa-price"
                type="number"
                step="any"
                placeholder="0.05"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={loading}
                className="font-mono"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {ALERT_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setAlertType(t.id)}
                  className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                    alertType === t.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pa-note" className="text-xs">Note (optional)</Label>
            <Input
              id="pa-note"
              placeholder="重仓买入价"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={loading}
            />
          </div>
          <Button
            onClick={() => void handleAdd()}
            disabled={loading || !symbol.trim() || !price.trim()}
            className="w-full gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add alert
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="text-muted-foreground py-10 text-center text-sm">
              No alerts yet. Try setting a target price for a coin you watch.
            </div>
          ) : (
            <div className="space-y-4">
              {active.length > 0 ? (
                <div>
                  <div className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
                    Active ({active.length})
                  </div>
                  <ul className="space-y-2">
                    {active.map((row) => (
                      <AlertItem
                        key={row.id}
                        row={row}
                        onDelete={() => void handleDelete(row.id)}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
              {fired.length > 0 ? (
                <div>
                  <div className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
                    Triggered ({fired.length})
                  </div>
                  <ul className="space-y-2 opacity-60">
                    {fired.map((row) => (
                      <AlertItem
                        key={row.id}
                        row={row}
                        onDelete={() => void handleDelete(row.id)}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AlertItem({
  row,
  onDelete,
}: {
  row: PriceAlertRow;
  onDelete: () => void;
}) {
  return (
    <li className="border-border hover:bg-accent/40 flex items-center justify-between rounded-md border px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-sm">
          <span className="font-semibold">{row.symbol}</span>
          <span className="text-muted-foreground"> · {row.alert_type} {row.direction === "above" ? "↑" : "↓"} </span>
          <span className="text-foreground">{row.target_price}</span>
        </span>
        {row.note ? (
          <span className="text-muted-foreground text-[11px]">{row.note}</span>
        ) : null}
        {row.triggered_at ? (
          <span className="text-emerald-400/80 text-[11px]">
            ✓ triggered {new Date(row.triggered_at).toLocaleString()}
          </span>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        className="text-muted-foreground hover:text-rose-400"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}
