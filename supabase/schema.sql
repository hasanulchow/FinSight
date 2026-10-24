-- FinSight schema. Run in the Supabase SQL editor.
-- The Node API writes with the service-role key (bypasses RLS);
-- the mobile app reads with the user's JWT (RLS applies).

create extension if not exists "pgcrypto";

-- One briefing per research run
create table if not exists public.briefings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ticker        text not null,
  company_name  text,
  status        text not null default 'running' check (status in ('running', 'complete', 'failed')),
  progress      text,                 -- current step, shown in the app while running
  source_data   jsonb,                -- quote, financials, filing list fetched by the tools
  content       jsonb,                -- final briefing produced by the agents
  error         text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index if not exists briefings_user_idx on public.briefings (user_id, created_at desc);

-- LLM-as-judge scores + deterministic checks for each briefing
create table if not exists public.evaluations (
  id            uuid primary key default gen_random_uuid(),
  briefing_id   uuid not null references public.briefings(id) on delete cascade,
  faithfulness  int check (faithfulness between 1 and 5),
  completeness  int check (completeness between 1 and 5),
  compliance    int check (compliance between 1 and 5),
  clarity       int check (clarity between 1 and 5),
  overall       numeric(3, 2),
  rationale     text,
  issues        jsonb,                -- unsupported claims the judge found
  checks        jsonb,                -- deterministic checks (disclaimer, banned phrases, ...)
  judge_model   text,
  created_at    timestamptz not null default now()
);
create index if not exists evaluations_briefing_idx on public.evaluations (briefing_id);

-- Per-agent trace: tokens, latency, model
create table if not exists public.agent_logs (
  id             uuid primary key default gen_random_uuid(),
  briefing_id    uuid references public.briefings(id) on delete cascade,
  agent          text not null,
  model          text,
  input_tokens   int,
  output_tokens  int,
  latency_ms     int,
  status         text not null default 'ok',
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists agent_logs_briefing_idx on public.agent_logs (briefing_id);

-- Advisor feedback (thumbs up/down)
create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  briefing_id  uuid not null references public.briefings(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  rating       int not null check (rating in (-1, 1)),
  comment      text,
  created_at   timestamptz not null default now(),
  unique (briefing_id, user_id)
);

-- Row-level security: users only see their own data
alter table public.briefings   enable row level security;
alter table public.evaluations enable row level security;
alter table public.agent_logs  enable row level security;
alter table public.feedback    enable row level security;

create policy "own briefings" on public.briefings
  for select using (auth.uid() = user_id);

create policy "evaluations of own briefings" on public.evaluations
  for select using (exists (
    select 1 from public.briefings b where b.id = briefing_id and b.user_id = auth.uid()
  ));

create policy "logs of own briefings" on public.agent_logs
  for select using (exists (
    select 1 from public.briefings b where b.id = briefing_id and b.user_id = auth.uid()
  ));

create policy "own feedback" on public.feedback
  for select using (auth.uid() = user_id);
