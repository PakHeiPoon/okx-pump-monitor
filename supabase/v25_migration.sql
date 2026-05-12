-- V2.5 migration: 加 oi_snapshots 表（持仓量增量监控用）。
-- 幂等可重跑。在 Supabase SQL Editor 粘贴执行。

create table if not exists public.oi_snapshots (
    inst_id      text primary key,
    oi           numeric(28,8) not null,              -- 张数（OKX 'oi'）
    oi_ccy       numeric(28,8),                       -- 折成 base currency
    oi_usd       numeric(28,2),                       -- 折成 USD（OKX 提供 oiUsd）
    snapshot_at  timestamptz not null default now()
);

create index if not exists oi_snapshots_snapshot_at_idx
    on public.oi_snapshots (snapshot_at desc);

alter table public.oi_snapshots enable row level security;

drop policy if exists oi_snapshots_read_anon on public.oi_snapshots;
create policy oi_snapshots_read_anon on public.oi_snapshots
    for select using (true);

-- direction CHECK 已经允许 4 值，新增 'surge' 不需要再放宽
-- source 字段是 text，没 CHECK，可以随便加 'oi_surge'
