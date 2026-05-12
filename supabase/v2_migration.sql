-- V2.0 migration: add meta JSONB + breakout_levels + price_alerts tables.
-- 幂等（IF NOT EXISTS / DO blocks），可重复跑。
-- 在 Supabase SQL Editor 粘贴整段执行。

-- ============ signals: 加 meta JSONB ============
-- 不同 monitor 用 meta 存自己的 context（funding_rate / level_price / vol_multiplier ...）
alter table public.signals
    add column if not exists meta jsonb not null default '{}'::jsonb;

-- direction CHECK 放宽到 4 个值（pump/dump/above/below），向后兼容老数据
do $$
begin
    if exists (
        select 1 from pg_constraint
        where conname = 'signals_direction_check'
    ) then
        alter table public.signals drop constraint signals_direction_check;
    end if;
    alter table public.signals
        add constraint signals_direction_check
        check (direction in ('pump', 'dump', 'above', 'below'));
end $$;


-- ============ breakout_levels: monitor ② 用 ============
-- 你给 BTC 定义 "突破 70000 触发"，scanner 每次 run 检查 last_price 是否首次穿越
create table if not exists public.breakout_levels (
    id                  bigserial primary key,
    symbol              text not null,
    inst_id             text not null,
    level_price         numeric(20,8) not null,
    direction           text not null check (direction in ('above', 'below')),
    label               text,                              -- "心理价位 70k"
    enabled             boolean not null default true,
    last_triggered_at   timestamptz,                       -- 最近触发时间（cooldown 用）
    created_at          timestamptz not null default now(),
    unique (inst_id, level_price, direction)
);

create index if not exists breakout_inst_idx
    on public.breakout_levels (inst_id) where enabled = true;


-- ============ price_alerts: monitor ⑤ 用 ============
-- TP（target）/ SL（stop_loss）/ 任意自定义价位
create table if not exists public.price_alerts (
    id              bigserial primary key,
    symbol          text not null,
    inst_id         text not null,
    target_price    numeric(20,8) not null,
    alert_type      text not null check (alert_type in ('target', 'stop_loss', 'custom')),
    direction       text not null check (direction in ('above', 'below')),
    note            text,
    enabled         boolean not null default true,
    triggered_at    timestamptz,                           -- 触发后置位（一次性告警，避免反复响）
    created_at      timestamptz not null default now()
);

create index if not exists price_alerts_inst_idx
    on public.price_alerts (inst_id) where enabled = true and triggered_at is null;


-- ============ RLS: anon 只读这两张新表，写靠 service_role ============
alter table public.breakout_levels enable row level security;
alter table public.price_alerts    enable row level security;

drop policy if exists breakout_read_anon on public.breakout_levels;
create policy breakout_read_anon on public.breakout_levels for select using (true);

drop policy if exists price_alerts_read_anon on public.price_alerts;
create policy price_alerts_read_anon on public.price_alerts for select using (true);
