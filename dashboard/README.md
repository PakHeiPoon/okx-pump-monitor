# OKX Pump Monitor — Dashboard

Real-time pump/dump signals dashboard for OKX USDT-margined perpetual swaps.
Reads from the same Supabase that the Python scanner (`../scanner/`) writes to.

Stack: Next.js 16 · React 19 · Tailwind v4 · shadcn/ui · Supabase REST.

## Local development

```bash
pnpm install
cp env.example .env.local         # then fill in real values
pnpm dev
```

Open http://localhost:3000

## Required environment variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | e.g. `https://xxxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` (RLS keeps it read-only) |

The publishable key is safe to expose in the browser — RLS policies in
`../supabase/schema.sql` only permit `SELECT` on `signals` / `monitor_config` /
`watchlist`. Scanner writes use the secret key on the server side only.

## Deploy to Vercel

1. Push this repo to GitHub (already done if you're reading this on GitHub).
2. On [vercel.com](https://vercel.com), click **Add New → Project** and import
   the `okx-pump-monitor` repository.
3. **Root Directory**: set to `dashboard` (this folder, not the repo root).
4. **Build & Output**: Vercel auto-detects Next.js — leave defaults.
5. **Environment Variables**: paste in the two `NEXT_PUBLIC_*` vars from above.
6. Click **Deploy** — first build ~2 minutes, subsequent ~30s.

## Folder layout

```
app/
  layout.tsx          dark mode + Geist fonts
  page.tsx            home (server component, fetches Supabase)
  globals.css         shadcn theme + Geist literal font names
components/
  live-dot.tsx        pulsing green Live indicator
  stat-bar.tsx        4 KPI cards (signals / pump / dump / volume)
  filter-sidebar.tsx  direction × source × time-window filter
  signals-table.tsx   main signal table with OKX trade links
  ui/                 shadcn primitives (button, card, table, badge, …)
lib/
  types.ts            Signal / StatsBundle / TimeWindow types
  supabase.ts         REST API wrapper (fetchSignals, fetchStats)
```

## Filters

URL search params drive the table — share a link with a filter already
applied:

- `?direction=pump` / `?direction=dump`
- `?source=swap_top_gainers` / `?source=watchlist`
- `?window=1h` / `?window=6h` / `?window=24h` / `?window=7d`
