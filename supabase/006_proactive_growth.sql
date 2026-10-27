-- FinSight migration 006: proactive agent (morning brief, thesis tracker, automations), trading rules,
-- broker sync, AI cost tracking, onboarding/referrals and share links.
-- Run in the Supabase SQL editor AFTER 005. Safe to re-run.

-- ---------- Per-user settings: onboarding, terms acceptance, referrals, rules ----------
create table if not exists public.user_settings (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  email              text,
  accepted_terms_at  timestamptz,
  terms_version      text,
  experience         text,
  goals              jsonb not null default '[]'::jsonb,
  onboarded_at       timestamptz,
  referral_code      text unique,
  referred_by        uuid references auth.users(id) on delete set null,
  pro_until          timestamptz,                         -- Pro days earned through referrals
  rules              jsonb not null default '{}'::jsonb,  -- pre-trade checklist rules
  brief_enabled      boolean not null default true,
  timezone           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists user_settings_referred_by_idx on public.user_settings (referred_by);

-- ---------- Watchlist + thesis tracker ----------
create table if not exists public.watchlist (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ticker      text not null,
  thesis      text,
  status      text check (status in ('unchecked', 'intact', 'watch', 'weakening', 'broken')),
  last_check  jsonb,                                       -- {summary, supporting, against, what_to_watch, checked_at, price}
  created_at  timestamptz not null default now(),
  unique (user_id, ticker)
);

-- ---------- Morning briefs ----------
create table if not exists public.daily_briefs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  content     jsonb not null,
  created_at  timestamptz not null default now(),
  unique (user_id, date)
);

-- ---------- Automations (scheduled Copilot tasks) ----------
create table if not exists public.copilot_tasks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  title            text not null,
  prompt           text not null,
  frequency        text not null default 'daily' check (frequency in ('daily', 'weekdays', 'weekly')),
  hour_utc         int not null check (hour_utc between 0 and 23),
  weekday          int check (weekday between 0 and 6),
  enabled          boolean not null default true,
  conversation_id  uuid references public.copilot_conversations(id) on delete set null,
  next_run_at      timestamptz,
  last_run_at      timestamptz,
  last_status      text,
  last_result      text,
  created_at       timestamptz not null default now()
);
create index if not exists copilot_tasks_due_idx on public.copilot_tasks (enabled, next_run_at);

-- ---------- Broker sync (SnapTrade). The user secret is AES-GCM encrypted by the server. ----------
create table if not exists public.broker_connections (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  snaptrade_user_id  text not null,
  user_secret_enc    text not null,
  last_sync_at       timestamptz,
  last_sync          jsonb,
  updated_at         timestamptz not null default now()
);
alter table public.trades add column if not exists external_id text;
create unique index if not exists trades_external_idx on public.trades (user_id, external_id) where external_id is not null;

-- ---------- AI cost per user ----------
create table if not exists public.ai_usage (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  agent          text,
  model          text,
  input_tokens   int,
  output_tokens  int,
  cost_usd       numeric(12, 6),
  created_at     timestamptz not null default now()
);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);

-- ---------- Public share links (snapshots, no personal data) ----------
create table if not exists public.shares (
  id          uuid primary key default gen_random_uuid(),
  token       text unique not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('briefing', 'journal')),
  ref_id      uuid,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

-- ---------- Row-level security ----------
-- The API uses the service-role key. Clients may read their own rows; broker_connections and
-- ai_usage have no client policies at all (secrets and internal costs stay server-side).
alter table public.user_settings       enable row level security;
alter table public.watchlist           enable row level security;
alter table public.daily_briefs        enable row level security;
alter table public.copilot_tasks       enable row level security;
alter table public.broker_connections  enable row level security;
alter table public.ai_usage            enable row level security;
alter table public.shares              enable row level security;

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings for select using (auth.uid() = user_id);
drop policy if exists "own watchlist" on public.watchlist;
create policy "own watchlist" on public.watchlist for select using (auth.uid() = user_id);
drop policy if exists "own briefs" on public.daily_briefs;
create policy "own briefs" on public.daily_briefs for select using (auth.uid() = user_id);
drop policy if exists "own tasks" on public.copilot_tasks;
create policy "own tasks" on public.copilot_tasks for select using (auth.uid() = user_id);
drop policy if exists "own shares" on public.shares;
create policy "own shares" on public.shares for select using (auth.uid() = user_id);
