-- V2.8 migration: watchdog scanner_heartbeat 表。
-- 幂等可重跑。在 Supabase SQL Editor 粘贴执行。
--
-- 目的：scanner 每次 run 写一行（无论是否检出信号），watchdog 每 10min 检查
-- 最新 heartbeat 是否新鲜（< 30min）。比"看 signals 表 detected_at"更鲁棒，
-- 因为全市场可能真的没信号，但 scanner 没挂。

create table if not exists public.scanner_heartbeat (
    id            bigserial primary key,
    started_at    timestamptz not null,
    finished_at   timestamptz not null default now(),
    duration_ms   int          not null,
    monitors_run  int          not null,           -- 启用了几个 monitor
    signals_found int          not null,           -- 本轮命中信号总数（去冷却前）
    fresh_signals int          not null,           -- 真正推 Feishu 的数量
    okx_errors    int          not null default 0, -- OKX API 调用失败次数
    meta          jsonb        not null default '{}'::jsonb,
    created_at    timestamptz  not null default now()
);

create index if not exists scanner_heartbeat_started_at_idx
    on public.scanner_heartbeat (started_at desc);

-- 保留最近 30 天即可，避免无限增长
-- （Supabase 不支持原生 TTL，可以手动加 cron job 或在 watchdog 里顺手清理）

alter table public.scanner_heartbeat enable row level security;

drop policy if exists scanner_heartbeat_read_anon on public.scanner_heartbeat;
create policy scanner_heartbeat_read_anon on public.scanner_heartbeat
    for select using (true);

-- ============ liquidations 表（V2.8 同批落地，给 liquidations monitor 用） ============
-- 不强依赖：monitor 也可以不写库，只发 Feishu。但写库后 dashboard /markets 页能展示。

create table if not exists public.liquidations (
    id            bigserial primary key,
    inst_id       text         not null,
    symbol        text         generated always as (
                      regexp_replace(inst_id, '-USDT-SWAP$', '')
                  ) stored,
    side          text         not null check (side in ('long', 'short')),
    price         numeric(20,8) not null,
    sz            numeric(28,8) not null,           -- 张数
    notional_usd  numeric(20,2) not null,           -- 折成 USD
    ts            timestamptz  not null,            -- OKX 给的 fill 时间
    ingested_at   timestamptz  not null default now()
);

create index if not exists liquidations_ts_idx
    on public.liquidations (ts desc);
create index if not exists liquidations_inst_ts_idx
    on public.liquidations (inst_id, ts desc);

alter table public.liquidations enable row level security;

drop policy if exists liquidations_read_anon on public.liquidations;
create policy liquidations_read_anon on public.liquidations
    for select using (true);
