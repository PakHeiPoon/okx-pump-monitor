import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Signal } from "@/lib/types";

interface SignalsTableProps {
  signals: Signal[];
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatVol(v: number): string {
  const n = Number(v);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function okxTradeUrl(instId: string): string {
  return `https://www.okx.com/trade-swap/${instId.toLowerCase()}`;
}

export function SignalsTable({ signals }: SignalsTableProps) {
  if (signals.length === 0) {
    return (
      <div className="bg-card border-border flex flex-col items-center justify-center gap-2 rounded-lg border p-12 text-center">
        <div className="text-muted-foreground text-sm">
          No signals in this window yet.
        </div>
        <div className="text-muted-foreground text-xs">
          Scanner runs every 15 min via cron-job.org. Hits land here as they
          come.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border-border overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[180px]">Symbol</TableHead>
            <TableHead className="w-[90px]">Dir</TableHead>
            <TableHead className="w-[110px] text-right">Change</TableHead>
            <TableHead className="w-[110px] text-right">Vol</TableHead>
            <TableHead className="w-[120px]">Source</TableHead>
            <TableHead className="w-[70px] text-right">Time</TableHead>
            <TableHead className="w-[60px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signals.map((s) => {
            const pump = s.direction === "pump";
            const chg = Number(s.chg_pct);
            return (
              <TableRow key={s.id} className="hover:bg-accent/30">
                <TableCell className="font-mono font-medium">
                  <span className="text-foreground">{s.symbol}</span>
                  <span className="text-muted-foreground ml-1 text-xs">
                    -USDT
                  </span>
                </TableCell>
                <TableCell>
                  {pump ? (
                    <Badge className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20">
                      🚀 Pump
                    </Badge>
                  ) : (
                    <Badge className="bg-rose-500/15 text-rose-400 hover:bg-rose-500/20">
                      📉 Dump
                    </Badge>
                  )}
                </TableCell>
                <TableCell
                  className={`text-right font-mono font-semibold ${
                    pump ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {pump ? "+" : ""}
                  {chg.toFixed(2)}%
                </TableCell>
                <TableCell className="text-muted-foreground text-right font-mono text-sm">
                  ${formatVol(Number(s.vol_usdt))}
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground text-xs">
                    {s.source === "swap_top_gainers"
                      ? "TOP50"
                      : s.source === "watchlist"
                      ? "Watch"
                      : s.source}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground text-right font-mono text-xs">
                  {timeAgo(s.detected_at)}
                </TableCell>
                <TableCell>
                  <a
                    href={okxTradeUrl(s.inst_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground inline-flex"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
