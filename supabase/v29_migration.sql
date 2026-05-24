-- V2.18 migration: mute_state（飞书静音状态）+ feishu_event_log（debug 用）。
-- 幂等可重跑。在 Supabase SQL Editor 粘贴执行。
--
-- 目的：用户 @ 飞书机器人发"mute"指令 → callback 写入 muted_until。
-- scanner.main / scanner.realtime 推送前查表，muted_until > now() 时跳过
-- Feishu send，但继续写 supabase + heartbeat（cron + 回测不受影响）。

create table if not exists public.mute_state (
    id            int          primary key default 1 check (id = 1),
    muted_until   timestamptz,                              -- null = 未静音
    muted_at      timestamptz,
    muted_by      text,                                     -- 飞书用户 open_id 或 name
    reason        text,                                     -- "30min" / "1h" / "until 18:00" / "off"
    updated_at    timestamptz  not null default now()
);

insert into public.mute_state (id) values (1) on conflict do nothing;

alter table public.mute_state enable row level security;

drop policy if exists mute_state_read_anon on public.mute_state;
create policy mute_state_read_anon on public.mute_state for select using (true);


-- ============ feishu_event_log（可选，debug 飞书 callback）============
create table if not exists public.feishu_event_log (
    id            bigserial primary key,
    event_type    text         not null,                    -- 'url_verification' / 'event_callback' / 'unknown'
    message_id    text,
    chat_id       text,
    sender_open_id text,
    raw_text      text,                                     -- 用户消息原文（去 @）
    parsed_cmd    text,                                     -- 'mute' / 'unmute' / 'status' / 'unknown'
    response      text,                                     -- 机器人回复
    ip            text,
    received_at   timestamptz  not null default now()
);

create index if not exists feishu_event_log_received_at_idx
    on public.feishu_event_log (received_at desc);

alter table public.feishu_event_log enable row level security;

drop policy if exists feishu_event_log_read_anon on public.feishu_event_log;
create policy feishu_event_log_read_anon on public.feishu_event_log for select using (true);
