import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

interface RoutePlaceholderProps {
  icon: LucideIcon;
  title: string;
  tagline: string;
  description: string;
  upcoming: ReadonlyArray<{
    label: string;
    detail: string;
    eta?: string;
  }>;
  backendDeps?: ReadonlyArray<string>;
}

export function RoutePlaceholder({
  icon: Icon,
  title,
  tagline,
  description,
  upcoming,
  backendDeps,
}: RoutePlaceholderProps) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 md:px-6 md:py-14">
      <div className="bg-card border-border rounded-lg border p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="bg-accent/50 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
            <Icon className="text-primary h-6 w-6" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-foreground text-xl font-semibold tracking-tight">
                {title}
              </h1>
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-300"
              >
                preview
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">{tagline}</p>
          </div>
        </div>

        <p className="text-muted-foreground mt-6 text-sm leading-relaxed">
          {description}
        </p>

        <div className="mt-8">
          <div className="text-foreground mb-3 text-sm font-semibold">
            🚧 即将上线的功能
          </div>
          <ul className="space-y-2">
            {upcoming.map((u) => (
              <li
                key={u.label}
                className="border-border/60 bg-background/40 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-foreground text-sm font-medium">
                    {u.label}
                  </span>
                  {u.eta ? (
                    <span className="text-muted-foreground font-mono text-xs">
                      {u.eta}
                    </span>
                  ) : null}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {u.detail}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {backendDeps && backendDeps.length > 0 ? (
          <div className="mt-6">
            <div className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wider">
              依赖后端能力
            </div>
            <div className="flex flex-wrap gap-1.5">
              {backendDeps.map((d) => (
                <Badge
                  key={d}
                  variant="secondary"
                  className="font-mono text-[10px]"
                >
                  {d}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
