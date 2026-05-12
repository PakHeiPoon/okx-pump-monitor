-- okx-pump-monitor: Supabase 数据库 schema
-- 在 Supabase Dashboard → SQL Editor 整段粘贴执行
-- V1（signals）+ V1.5（watchlist / per-coin override）前向兼容

-- ============ signals 信号表 ============
create table if not exists public.signals (
    id           bigserial primary key,
    inst_id      text         not null,                                   -- BTC-USDT-SWAP
    symbol       text         generated always as (
                    regexp_replace(inst_id, '-USDT-SWAP$', '')
                 ) stored,                                                 -- BTC（dashboard 显示用）
    direction    text         not null check (direction in ('pump','dump')),
    chg_pct      numeric(8,2)  not null,
    vol_usdt     numeric(20,0) not null,
    bars         int          not null,
    open_price   numeric(20,8) not null,
    close_price  numeric(20,8) not null,
    bar_ts       timestamptz  not null,
    detected_at  timestamptz  not null default now(),
    source       text         not null default 'swap_top_gainers'         -- 区分 monitor 来源
);

create index if not exists signals_detected_at_idx on public.signals (detected_at desc);
create index if not exists signals_inst_idx        on public.signals (inst_id, detected_at desc);
create index if not exists signals_direction_idx   on public.signals (direction, detected_at desc);
create index if not exists signals_source_idx      on public.signals (source, detected_at desc);

-- ============ monitor_config 全局配置（单行） ============
create table if not exists public.monitor_config (
    id              int          primary key default 1 check (id = 1),
    pump_threshold  numeric(5,2)  not null default 3.0,
    dump_threshold  numeric(5,2)  not null default 5.0,
    min_vol_usdt    bigint       not null default 50000,
    top_n           int          not null default 50,
    lookback_bars   int          not null default 16,
    cooldown_min    int          not null default 30,
    enabled_monitors text[]      not null default array['swap_top_gainers']::text[],
    updated_at      timestamptz  not null default now()
);

insert into public.monitor_config (id) values (1) on conflict do nothing;

-- ============ watchlist 自选币表（V1.5 用，per-coin override 一并支持） ============
create table if not exists public.watchlist (
    symbol                  text        primary key,                       -- 'PENGU' / 'TRUMP' / 'DOGE'
    inst_id                 text        not null,                           -- 'PENGU-USDT-SWAP'（系统自动拼）
    pump_threshold_override numeric(5,2),                                  -- null = 跟全局
    dump_threshold_override numeric(5,2),
    note                    text,                                          -- 用户备注 "重仓中"
    added_at                timestamptz not null default now()
);

create index if not exists watchlist_inst_idx on public.watchlist (inst_id);

-- ============ RLS（dashboard 用 anon key 只读，scanner 用 service_role 写）============
alter table public.signals        enable row level security;
alter table public.monitor_config enable row level security;
alter table public.watchlist      enable row level security;

drop policy if exists signals_read_anon on public.signals;
create policy signals_read_anon on public.signals for select using (true);

drop policy if exists config_read_anon on public.monitor_config;
create policy config_read_anon on public.monitor_config for select using (true);

drop policy if exists watchlist_read_anon on public.watchlist;
create policy watchlist_read_anon on public.watchlist for select using (true);

-- 写入靠 service_role key 自动 bypass RLS；后续 V1.5 加 dashboard 写时再加 policy。
