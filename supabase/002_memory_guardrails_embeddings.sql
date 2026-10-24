-- FinSight migration 002: embeddings (pgvector), memory, guardrail audit log, richer evaluation.
-- Run in the Supabase SQL editor AFTER schema.sql. Safe to re-run.

create extension if not exists vector;

-- ---------- Embeddings: chunked 10-K sections ----------
-- Shared across users (public SEC filings). Written and read only by the API (service role).
create table if not exists public.filing_chunks (
  id               uuid primary key default gen_random_uuid(),
  source_url       text not null,          -- 10-K document URL on sec.gov
  ticker           text,
  cik              text,
  section          text not null,          -- "Item 1A. Risk Factors", ...
  chunk_index      int  not null,
  content          text not null,
  embedding        vector(1024),           -- Voyage voyage-4 (null when embeddings are not configured)
  embedding_model  text,
  created_at       timestamptz not null default now(),
  unique (source_url, section, chunk_index)
);
create index if not exists filing_chunks_url_idx on public.filing_chunks (source_url);
create index if not exists filing_chunks_embedding_idx on public.filing_chunks using hnsw (embedding vector_cosine_ops);

-- Top-k chunks of one filing by cosine similarity
create or replace function public.match_filing_chunks(query_embedding vector(1024), filing_url text, match_count int default 6)
returns table (id uuid, section text, chunk_index int, content text, similarity float)
language sql stable
as $$
  select c.id, c.section, c.chunk_index, c.content, 1 - (c.embedding <=> query_embedding) as similarity
  from public.filing_chunks c
  where c.source_url = filing_url and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
revoke execute on function public.match_filing_chunks(vector, text, int) from public, anon, authenticated;

-- ---------- Memory ----------
-- Advisor preferences and notes, used by the Briefing Writer
create table if not exists public.advisor_memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null default 'note' check (kind in ('preference', 'note', 'client_context')),
  ticker      text,                        -- null = applies to every briefing
  content     text not null check (char_length(content) <= 500),
  created_at  timestamptz not null default now()
);
create index if not exists advisor_memories_user_idx on public.advisor_memories (user_id, created_at desc);

-- Conversation memory for Filing Q&A
create table if not exists public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  briefing_id  uuid not null references public.briefings(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('user', 'assistant')),
  content      text not null,
  citations    jsonb,                      -- [{n, section, excerpt, score}]
  guardrail    jsonb,                      -- input flags / output actions for this message
  evaluation   jsonb,                      -- LLM-judge scores for assistant answers
  created_at   timestamptz not null default now()
);
create index if not exists chat_messages_briefing_idx on public.chat_messages (briefing_id, created_at);
create index if not exists chat_messages_user_idx on public.chat_messages (user_id, created_at desc);

-- ---------- Guardrails audit log ----------
create table if not exists public.guardrail_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  briefing_id  uuid references public.briefings(id) on delete cascade,
  stage        text not null check (stage in ('input', 'retrieval', 'output')),
  rule         text not null,              -- prompt_injection, pii, rate_limit, banned_phrase, advice_request, ...
  action       text not null,              -- blocked, redacted, removed, flagged, neutral_answer
  detail       jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists guardrail_events_user_idx on public.guardrail_events (user_id, created_at desc);

-- ---------- Evaluation: grounding metrics ----------
alter table public.evaluations add column if not exists grounding jsonb;  -- {evidence: {...}, numbers: {...}}

-- ---------- Row-level security ----------
alter table public.filing_chunks    enable row level security;  -- no policies: API (service role) only
alter table public.advisor_memories enable row level security;
alter table public.chat_messages    enable row level security;
alter table public.guardrail_events enable row level security;

drop policy if exists "own memories" on public.advisor_memories;
create policy "own memories" on public.advisor_memories for select using (auth.uid() = user_id);

drop policy if exists "own chat" on public.chat_messages;
create policy "own chat" on public.chat_messages for select using (auth.uid() = user_id);

drop policy if exists "own guardrail events" on public.guardrail_events;
create policy "own guardrail events" on public.guardrail_events for select using (auth.uid() = user_id);
