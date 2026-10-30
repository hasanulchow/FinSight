-- FinSight migration 008: trading bots (rule-based pattern strategies) and their signals.
-- Run in the Supabase SQL editor AFTER 007. Safe to re-run.

create table if not exists public.trading_bots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  template     text not null default 'bull_flag_breakout',
  config       jsonb not null,            -- universe, market filter, pattern, entry, exit, sizing, mode (paper | alert)
  enabled      boolean not null default false,
  state        jsonb not null default '{}'::jsonb,   -- scan cursor, last run log, last market regime
  last_run_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists trading_bots_enabled_idx on public.trading_bots (enabled);

create table if not exists public.bot_signals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  bot_id          uuid not null references public.trading_bots(id) on delete cascade,
  ticker          text not null,
  flag_start      date,
  status          text not null check (status in ('watching', 'alerted', 'pending_entry', 'entered', 'exited', 'skipped')),
  setup           jsonb,                 -- the detected pattern and its levels
  plan            jsonb,                 -- entry, stop, target, shares, risk
  reason          text,
  entry_order_id  uuid,
  stop_order_id   uuid,
  entry_price     numeric,
  entered_at      timestamptz,
  exit_price      numeric,
  exit_reason     text,
  exited_at       timestamptz,
  r_multiple      numeric,
  created_at      timestamptz not null default now(),
  unique (bot_id, ticker, flag_start)
);
create index if not exists bot_signals_bot_idx on public.bot_signals (bot_id, created_at desc);

alter table public.trading_bots enable row level security;
alter table public.bot_signals  enable row level security;
drop policy if exists "own bots" on public.trading_bots;
create policy "own bots" on public.trading_bots for select using (auth.uid() = user_id);
drop policy if exists "own bot signals" on public.bot_signals;
create policy "own bot signals" on public.bot_signals for select using (auth.uid() = user_id);
