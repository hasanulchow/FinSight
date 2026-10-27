-- FinSight migration 003: technical analysis, alerts, notifications, screener, earnings/insiders, portfolio.
-- Run in the Supabase SQL editor AFTER schema.sql and 002. Safe to re-run.

-- ---------- Shared market-data caches (API/service role only) ----------
create table if not exists public.price_bars (
  ticker      text primary key,
  bars        jsonb not null,               -- [{t,o,h,l,c,v}] daily, oldest first
  fetched_at  timestamptz not null default now()
);

create table if not exists public.screener_snapshots (
  ticker        text primary key,
  name          text,
  sector        text,
  data          jsonb not null,             -- price, market cap, P/E, RSI, SMA position, performance, growth...
  refreshed_at  timestamptz not null default now()
);

create table if not exists public.stock_events_cache (
  ticker      text primary key,
  data        jsonb not null,               -- earnings calendar, surprises, insider trades, AI summary
  fetched_at  timestamptz not null default now()
);

-- ---------- Alerts and notifications ----------
create table if not exists public.alerts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  ticker             text not null,
  type               text not null check (type in (
                       'price_above', 'price_below', 'rsi_above', 'rsi_below', 'golden_cross', 'death_cross',
                       'macd_bullish_cross', 'macd_bearish_cross', 'volume_spike', 'new_filing', 'earnings_soon', 'insider_buy')),
  threshold          numeric,               -- price or RSI level where relevant
  active             boolean not null default true,
  repeat             boolean not null default false,  -- false = fire once, then deactivate
  last_triggered_at  timestamptz,
  state              jsonb,                 -- e.g. last seen filing accession, to fire only on new events
  created_at         timestamptz not null default now()
);
create index if not exists alerts_active_idx on public.alerts (active, ticker);
create index if not exists alerts_user_idx on public.alerts (user_id, created_at desc);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,                -- alert, digest, ...
  ticker      text,
  title       text not null,
  body        text not null,
  data        jsonb,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.push_tokens (
  token       text primary key,             -- ExponentPushToken[...]
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text,
  updated_at  timestamptz not null default now()
);

-- ---------- Portfolio ----------
create table if not exists public.holdings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ticker      text not null,
  shares      numeric not null check (shares > 0),
  cost_basis  numeric,                      -- per share, optional
  created_at  timestamptz not null default now(),
  unique (user_id, ticker)
);

-- ---------- Row-level security ----------
alter table public.price_bars          enable row level security;  -- API only
alter table public.screener_snapshots  enable row level security;  -- API only
alter table public.stock_events_cache  enable row level security;  -- API only
alter table public.alerts              enable row level security;
alter table public.notifications       enable row level security;
alter table public.push_tokens         enable row level security;
alter table public.holdings            enable row level security;

drop policy if exists "own alerts" on public.alerts;
create policy "own alerts" on public.alerts for select using (auth.uid() = user_id);
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications for select using (auth.uid() = user_id);
drop policy if exists "own holdings" on public.holdings;
create policy "own holdings" on public.holdings for select using (auth.uid() = user_id);
