-- FinSight migration 004: shared cache for options overviews and market snapshots.
-- Run in the Supabase SQL editor AFTER 003. Safe to re-run.

create table if not exists public.kv_cache (
  key         text primary key,          -- e.g. "options:AAPL:2026-11-20", "market:overview"
  data        jsonb not null,
  fetched_at  timestamptz not null default now()
);

alter table public.kv_cache enable row level security;  -- API (service role) only
