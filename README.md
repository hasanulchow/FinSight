# FinSight: AI stock briefings for wealth advisors

Advisors type a ticker and get a briefing in about a minute: live quote, multi-year financials from SEC XBRL data, a business and MD&A summary from the latest 10-K, top risk factors, recent filings, client talking points and a compliance-safe disclaimer. Every briefing is scored by an LLM judge plus automated checks.

**Stack:** React Native (Expo) · Node.js (Express) · Claude Sonnet 5.5 · Supabase (Postgres + Auth) · SEC EDGAR · Finnhub · Vercel

## Architecture

```
Expo app ──(Supabase JWT)──► Node API on Vercel ──► SEC EDGAR, Finnhub (data tools)
   │                              │
   └── Supabase Auth              ├──► Claude API (7 agents)
                                  └──► Supabase Postgres (briefings, evaluations, agent_logs, feedback)
```

### Multi-agent pipeline (`server/src/agents/`)

```
Orchestrator
  ├─ tools (parallel): quote · SEC financials (XBRL) · filing list · latest 10-K sections
  ├─ Market Analyst ─┐
  ├─ Fundamentals ───┤ (parallel)
  ├─ Filings Analyst ┤
  ├─ Risk Analyst ───┘
  ├─ Briefing Writer      combines the four analyses
  ├─ Compliance Reviewer  removes recommendations, predictions, guarantees
  └─ Evaluator            LLM-as-judge vs. the raw source data
```

| Agent | Input | Output |
|---|---|---|
| Market Analyst | Finnhub quote + key stats | Headline, commentary, notable stats |
| Fundamentals Analyst | 4 years of SEC XBRL financials | Trends, strengths, concerns |
| Filings Analyst | 10-K Item 1 + Item 7, recent filings | Business overview, segments, outlook, events |
| Risk Analyst | 10-K Item 1A | Top 5 risks, each with a verbatim evidence quote |
| Briefing Writer | All four analyses | Executive summary, takeaways, talking points, questions |
| Compliance Reviewer | Draft briefing | Revised briefing + list of fixes |
| Evaluator | Final briefing + raw source data | 1–5 scores and unsupported claims |

Every agent returns schema-validated JSON (Claude structured outputs). Financial figures shown in the app come straight from SEC data, not from the LLM.

### Embeddings and retrieval (`lib/embeddings.js`, `lib/retrieval.js`)

- During each briefing, the latest 10-K (Items 1, 1A and 7) is split into ~1,500-character chunks that overlap at sentence boundaries. The chunks are embedded with **Voyage AI** (`voyage-4`, 1024 dimensions) and stored in Supabase **pgvector** (`filing_chunks`, HNSW index). This runs in parallel with the analysts.
- Filings never change, so each one is indexed once and reused by every user.
- **Filing Q&A** searches the index with the `match_filing_chunks` SQL function (cosine similarity).
- Without `VOYAGE_API_KEY`, chunks are stored without vectors and search falls back to TF-IDF keyword matching.

### Memory (`lib/memory.js`)

| Kind | What | Used by |
|---|---|---|
| Advisor memory | Saved preferences and notes (`preference`, `note`, `client_context`), optionally tied to a ticker (`/memory`) | Briefing Writer: decides what to emphasize (e.g. dividends for income clients) |
| Research memory | The advisor's previous briefing on the same ticker | Briefing Writer: fills `changes_since_last` |
| Conversation memory | Chat history per briefing (`chat_messages`) | Filing Q&A: resolves follow-ups ("and tariffs?") |

Memory is treated as data, not instructions: it's fenced in the prompt and screened by the input guardrails before it's saved.

### Guardrails (`lib/guardrails.js`)

| Stage | Guardrail | Action |
|---|---|---|
| Input | Per-user rate limits (`BRIEFINGS_PER_HOUR`, `QUESTIONS_PER_HOUR`) | 429 |
| Input | Prompt-injection patterns in questions and memories | Blocked (400) |
| Input | PII: SSNs, card numbers (Luhn-checked), account numbers, emails, phones | Redacted before storage or LLM use |
| Input | Requests for buy/sell advice or price predictions | Answered neutrally (agent told to decline the opinion) |
| Retrieval | Filing passages are fenced as data; instruction-like passages are flagged | Flagged |
| Output | Compliance Reviewer agent, then a deterministic pass that removes any sentence still recommending, predicting or guaranteeing | Removed |
| Output | PII in generated answers | Flagged |

Every action is written to `guardrail_events` as an audit trail.

### LLM evaluation

1. **Automated checks on every briefing** (`deterministicChecks`): disclaimer present, no banned phrases or PII in the generated text, quote freshness, financials, risks and summary present, evidence verified, numbers grounded.
2. **Grounding metrics** (`lib/grounding.js`, stored in `evaluations.grounding`):
   - **Evidence match:** share of the Risk Analyst's quotes that really appear in the 10-K (exact or ≥ 70% 5-gram overlap).
   - **Numeric grounding:** share of numbers in the narrative that trace back to XBRL data, the quote, derived growth rates and margins, or the 10-K text.
3. **LLM-as-judge on every briefing**: faithfulness, completeness, compliance and clarity (1–5) plus a list of unsupported claims, saved to `evaluations` and shown in the app.
4. **Q&A evaluation**: every answer is checked for valid citations and graded by an LLM judge (faithfulness to the passages, relevance, compliance). The scores are saved on the chat message.
5. **Offline eval set** (`server/evals/golden.json`): 5 tickers across sectors, each with expected risk keywords. `npm run eval` runs the full pipeline, prints a score table (including the grounding rates) and saves results to `server/evals/results/`.
6. **Dashboard** (`GET /evals/summary`): average briefing and Q&A scores, grounding rates, guardrail events by rule, and how often the judge agrees with advisor 👍/👎.
7. **Tracing**: every Claude call is logged to `agent_logs` (agent, model, tokens, latency). The app shows the trace under each briefing.

## Setup

**Requirements:** Node.js 22 or later (Expo SDK 58 and supabase-js need it), and the Expo Go app on your phone.

### 1. Supabase
1. Create a project at supabase.com.
2. In the SQL editor, run `supabase/schema.sql`, then `supabase/002_memory_guardrails_embeddings.sql` (pgvector, memory, chat, guardrail log).
3. Authentication → Providers → Email: enabled. For a quick demo, turn off "Confirm email".
4. Project Settings → API: copy the URL, the anon key and the service-role key.

### 2. API keys
- Anthropic: console.anthropic.com → API keys
- Finnhub: finnhub.io (free tier)
- Voyage AI (optional, for vector search): dash.voyageai.com

### 3. Server
```bash
cd server
cp .env.example .env      # fill in the keys
npm install
npm run dev               # http://localhost:3001/health
```

### 4. Mobile app
```bash
cd mobile
cp .env.example .env      # Supabase URL + anon key, and the API URL
npm install
npx expo install --fix    # aligns native package versions with the installed Expo SDK
npx expo start            # scan the QR code with Expo Go
```
On a phone, `localhost` refers to the phone itself. Set `EXPO_PUBLIC_API_URL` to your computer's LAN IP (e.g. `http://192.168.1.20:3001`) or to the Vercel URL.

### 5. Offline eval
```bash
cd server
npm run eval              # all golden tickers (8 Claude calls each)
npm run eval -- NVDA      # one ticker
```

## Deploy

- **Web app + API → Vercel (one project):** import the GitHub repo on vercel.com and keep the root directory as the repo root; `vercel.json` sets everything else. The build exports the Expo web app to `mobile/dist` (served from Vercel's CDN), and `api/index.js` runs the Express API as a serverless function. `/health`, `/briefings/*`, `/memory/*` and `/evals/*` are rewritten to it, so the app and API share one origin and `EXPO_PUBLIC_API_URL` isn't needed for web. Add the server variables and `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (baked into the web bundle at build time) under Project Settings → Environment Variables.
- **Background agents on Vercel:** `POST /briefings` responds immediately and keeps the function alive with `waitUntil` until the agents finish, up to `maxDuration` (300 s in `vercel.json`, which needs Fluid compute: on by default for new projects).
- **Native app (later):** set `EXPO_PUBLIC_API_URL` to the Vercel URL, then demo through Expo Go or build with EAS (`eas build`).

## API

All routes need `Authorization: Bearer <Supabase access token>`.

| Method | Path | Description |
|---|---|---|
| POST | `/briefings` | `{ ticker }` → `{ id }` (202). Agents run in the background. |
| GET | `/briefings` | The user's recent briefings with overall score |
| GET | `/briefings/:id` | Status, progress, content, evaluation, agent trace |
| POST | `/briefings/:id/feedback` | `{ rating: 1 \| -1 }` |
| POST | `/briefings/:id/ask` | `{ question }` → cited answer from the 10-K (retrieval + conversation memory + guardrails). The answer is evaluated in the background. |
| GET | `/briefings/:id/chat` | Conversation history with citations and evaluation scores |
| GET | `/memory` | The advisor's saved memories |
| POST | `/memory` | `{ content, kind?: preference \| note \| client_context, ticker? }` (PII redacted, injection blocked) |
| DELETE | `/memory/:id` | Delete a memory |
| GET | `/evals/summary` | Quality dashboard: scores, grounding, Q&A, guardrails, feedback agreement |

## Known limitations

- US SEC registrants only (ticker → CIK via SEC's ticker list).
- Some companies (e.g. JPM, PFE, CVX) put MD&A in a separate annual-report exhibit; the outlook section then says "not available".
- Companies with a new SEC registration and no 10-K yet (e.g. ExxonMobil's 2026 holding company) get a briefing without filing text.
- Very long Risk Factors sections are truncated at 120k characters; the agent is told when this happens.
- AI-generated content for internal advisor use only; not investment advice.
