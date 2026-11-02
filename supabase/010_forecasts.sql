-- FinSight migration 010: Forecasts, a play-money prediction game on where stocks close.
-- Run in the Supabase SQL editor AFTER 009. Safe to re-run.

-- Shared questions: "Will TICKER close above STRIKE on RESOLVE_DATE?"
create table if not exists public.forecast_questions (
  id                 uuid primary key default gen_random_uuid(),
  ticker             text not null,
  strike             numeric not null,
  resolve_date       date not null,
  status             text not null default 'open' check (status in ('open', 'resolved', 'void')),
  source             text not null default 'auto' check (source in ('auto', 'user')),
  created_by         uuid references auth.users(id) on delete set null,
  ref_price          numeric,                -- price when the question was created
  sigma              numeric,                -- annualized volatility behind the market odds
  sigma_source       text,                   -- 'options' (implied) or 'volatility' (historical)
  sigma_updated_at   timestamptz,
  outcome            boolean,
  close_price        numeric,
  final_market_prob  numeric,                -- market odds going into the last session
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (ticker, strike, resolve_date)
);
create index if not exists forecast_questions_open_idx on public.forecast_questions (status, resolve_date);

-- One forecast per user per question (updatable until the open on the resolution day)
create table if not exists public.forecasts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  question_id   uuid not null references public.forecast_questions(id) on delete cascade,
  prob          numeric not null check (prob > 0 and prob < 1),
  market_prob   numeric,                     -- market odds when the forecast was made
  price_at      numeric,
  outcome       boolean,
  points        integer,
  resolved_at   timestamptz,
  updated_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, question_id)
);
create index if not exists forecasts_question_idx on public.forecasts (question_id);
create index if not exists forecasts_user_idx on public.forecasts (user_id, resolved_at);

-- Leaderboard names
create table if not exists public.forecast_profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  nickname    text not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists forecast_profiles_nickname_idx on public.forecast_profiles (lower(nickname));

alter table public.forecast_questions enable row level security;
alter table public.forecasts          enable row level security;
alter table public.forecast_profiles  enable row level security;
drop policy if exists "questions are public to signed-in users" on public.forecast_questions;
create policy "questions are public to signed-in users" on public.forecast_questions for select using (auth.role() = 'authenticated');
drop policy if exists "own forecasts" on public.forecasts;
create policy "own forecasts" on public.forecasts for select using (auth.uid() = user_id);
drop policy if exists "own forecast profile" on public.forecast_profiles;
create policy "own forecast profile" on public.forecast_profiles for select using (auth.uid() = user_id);
