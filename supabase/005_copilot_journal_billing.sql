-- FinSight migration 005: Copilot agent, trade journal, plans/usage and Stripe subscriptions.
-- Run in the Supabase SQL editor AFTER 004. Safe to re-run.

-- ---------- Trade journal ----------
create table if not exists public.trades (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ticker        text not null,
  side          text not null default 'long' check (side in ('long', 'short')),
  instrument    text not null default 'stock' check (instrument in ('stock', 'option', 'etf', 'crypto', 'future')),
  quantity      numeric not null check (quantity > 0),
  entry_price   numeric not null check (entry_price > 0),
  entry_date    date not null default current_date,
  exit_price    numeric check (exit_price > 0),
  exit_date     date,
  stop_price    numeric,
  target_price  numeric,
  setup         text,
  emotion       text,
  notes         text,
  fees          numeric default 0,
  created_at    timestamptz not null default now()
);
create index if not exists trades_user_idx on public.trades (user_id, entry_date desc);

-- ---------- Plans, usage and billing ----------
create table if not exists public.subscriptions (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  plan                    text not null default 'free',
  status                  text not null default 'inactive',   -- Stripe status: active, trialing, past_due, canceled...
  stripe_customer_id      text,
  stripe_subscription_id  text,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  updated_at              timestamptz not null default now()
);

create table if not exists public.usage_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  feature     text not null,                -- briefing, copilot, ai_tool, question
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists usage_events_user_day_idx on public.usage_events (user_id, feature, created_at desc);

-- ---------- Copilot ----------
create table if not exists public.copilot_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists copilot_conversations_user_idx on public.copilot_conversations (user_id, updated_at desc);

create table if not exists public.copilot_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.copilot_conversations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  trace            jsonb,                   -- tools the agent called: [{tool, input, ok, ms}]
  actions          jsonb,                   -- actions it proposed in this turn
  created_at       timestamptz not null default now()
);
create index if not exists copilot_messages_conv_idx on public.copilot_messages (conversation_id, created_at);

-- Changes the agent proposed; executed only when the user confirms (human in the loop)
create table if not exists public.copilot_actions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  conversation_id  uuid references public.copilot_conversations(id) on delete cascade,
  tool             text not null,           -- create_alert, add_holding, log_trade
  input            jsonb not null,
  summary          text,
  status           text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'failed')),
  result           jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists copilot_actions_user_idx on public.copilot_actions (user_id, status);

-- ---------- Row-level security ----------
alter table public.trades                 enable row level security;
alter table public.subscriptions          enable row level security;
alter table public.usage_events           enable row level security;
alter table public.copilot_conversations  enable row level security;
alter table public.copilot_messages       enable row level security;
alter table public.copilot_actions        enable row level security;

drop policy if exists "own trades" on public.trades;
create policy "own trades" on public.trades for select using (auth.uid() = user_id);
drop policy if exists "own subscription" on public.subscriptions;
create policy "own subscription" on public.subscriptions for select using (auth.uid() = user_id);
drop policy if exists "own usage" on public.usage_events;
create policy "own usage" on public.usage_events for select using (auth.uid() = user_id);
drop policy if exists "own conversations" on public.copilot_conversations;
create policy "own conversations" on public.copilot_conversations for select using (auth.uid() = user_id);
drop policy if exists "own copilot messages" on public.copilot_messages;
create policy "own copilot messages" on public.copilot_messages for select using (auth.uid() = user_id);
drop policy if exists "own copilot actions" on public.copilot_actions;
create policy "own copilot actions" on public.copilot_actions for select using (auth.uid() = user_id);
