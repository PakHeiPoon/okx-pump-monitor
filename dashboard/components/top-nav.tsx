"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap } from "lucide-react";

import { NAV_ITEMS } from "@/lib/nav-items";

import { HealthDot } from "@/components/health-dot";

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="border-border bg-background/95 sticky top-0 z-20 border-b backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 transition-opacity hover:opacity-80"
          >
            <Zap className="text-primary h-5 w-5" />
            <span className="text-sm font-semibold tracking-tight md:text-base">
              OKX Pump Monitor
            </span>
          </Link>

          <nav className="hidden items-center gap-0.5 md:flex">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.description}
                  className={`group relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                  {item.status === "preview" ? (
                    <span className="text-muted-foreground/70 ml-0.5 hidden rounded bg-amber-500/10 px-1 text-[9px] font-semibold uppercase tracking-wider text-amber-300/80 lg:inline">
                      preview
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <HealthDot />
        </div>
      </div>

      {/* Mobile nav: horizontal scroll row */}
      <nav className="border-border/60 flex items-center gap-0.5 overflow-x-auto border-t px-3 py-1.5 md:hidden">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
