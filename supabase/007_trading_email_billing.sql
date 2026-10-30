-- FinSight migration 007: paper trading, live orders through the user's broker, weekly email
-- preferences, annual plan / pause fields and cancel-flow feedback.
-- Run in the Supabase SQL editor AFTER 006. Safe to re-run.

-- ---------- Paper trading ----------
create table if not exists public.paper_accounts (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  cash           numeric not null default 100000,
  starting_cash  numeric not null default 100000,
  realized_pnl   numeric not null default 0,
  resets         int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.paper_positions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ticker      text not null,
  qty         numeric not null check (qty > 0),
  avg_cost    numeric not null,
  opened_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, ticker)
);

create table if not exists public.paper_orders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  ticker         text not null,
  side           text not null check (side in ('buy', 'sell')),
  type           text not null check (type in ('market', 'limit', 'stop')),
  qty            numeric not null check (qty > 0),
  limit_price    numeric,
  stop_price     numeric,
  time_in_force  text not null default 'gtc' check (time_in_force in ('day', 'gtc')),
  status         text not null default 'open' check (status in ('open', 'filled', 'cancelled', 'rejected', 'expired')),
  est_price      numeric,
  filled_price   numeric,
  filled_at      timestamptz,
  closed_at      timestamptz,
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists paper_orders_open_idx on public.paper_orders (status, user_id) where status = 'open';
create index if not exists paper_orders_user_idx on public.paper_orders (user_id, created_at desc);

-- ---------- Live orders (audit trail of previews and placements through SnapTrade) ----------
create table if not exists public.live_orders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  account_id   text not null,
  ticker       text not null,
  side         text not null check (side in ('buy', 'sell')),
  type         text not null,
  qty          numeric not null,
  limit_price  numeric,
  stop_price   numeric,
  trade_id     text,
  status       text not null check (status in ('previewed', 'placed', 'failed', 'expired')),
  preview      jsonb,
  result       jsonb,
  placed_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists live_orders_user_idx on public.live_orders (user_id, created_at desc);

-- ---------- Email, billing and cancel flow ----------
alter table public.user_settings add column if not exists weekly_email boolean not null default true;
alter table public.user_settings add column if not exists last_weekly_email date;
alter table public.subscriptions add column if not exists interval text;
alter table public.subscriptions add column if not exists paused_until timestamptz;

create table if not exists public.cancel_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  reason      text not null,
  feedback    text,
  action      text not null,      -- pause, discount, cancel, resume
  created_at  timestamptz not null default now()
);

-- ---------- Row-level security (the API uses the service role; clients may read their own rows) ----------
alter table public.paper_accounts   enable row level security;
alter table public.paper_positions  enable row level security;
alter table public.paper_orders     enable row level security;
alter table public.live_orders      enable row level security;
alter table public.cancel_feedback  enable row level security;

drop policy if exists "own paper account" on public.paper_accounts;
create policy "own paper account" on public.paper_accounts for select using (auth.uid() = user_id);
drop policy if exists "own paper positions" on public.paper_positions;
create policy "own paper positions" on public.paper_positions for select using (auth.uid() = user_id);
drop policy if exists "own paper orders" on public.paper_orders;
create policy "own paper orders" on public.paper_orders for select using (auth.uid() = user_id);
drop policy if exists "own live orders" on public.live_orders;
create policy "own live orders" on public.live_orders for select using (auth.uid() = user_id);
