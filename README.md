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

### LLM evaluation

1. **Automated checks on every briefing** (`deterministicChecks`): disclaimer present, no banned phrases ("guaranteed", "price target", ...), quote freshness, financials, risks and summary present.
2. **LLM-as-judge on every briefing**: faithfulness, completeness, compliance and clarity (1–5) plus a list of unsupported claims, saved to `evaluations` and shown in the app.
3. **Offline eval set** (`server/evals/golden.json`): 5 tickers across sectors, each with expected risk keywords. `npm run eval` runs the full pipeline, prints a score table and saves results to `server/evals/results/`.
4. **Tracing**: every Claude call is logged to `agent_logs` (agent, model, tokens, latency). The app shows the trace under each briefing.
5. **Advisor feedback**: thumbs up/down saved to `feedback`.

## Setup

**Requirements:** Node.js 22 or later (Expo SDK 58 and supabase-js need it), and the Expo Go app on your phone.

### 1. Supabase
1. Create a project at supabase.com.
2. In the SQL editor, run `supabase/schema.sql`.
3. Authentication → Providers → Email: enabled. For a quick demo, turn off "Confirm email".
4. Project Settings → API: copy the URL, the anon key and the service-role key.

### 2. API keys
- Anthropic: console.anthropic.com → API keys
- Finnhub: finnhub.io (free tier)

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

- **Web app + API → Vercel (one project):** import the GitHub repo on vercel.com and keep the root directory as the repo root; `vercel.json` sets everything else. The build exports the Expo web app to `mobile/dist` (served from Vercel's CDN), and `api/index.js` runs the Express API as a serverless function. `/health` and `/briefings/*` are rewritten to it, so the app and API share one origin and `EXPO_PUBLIC_API_URL` isn't needed for web. Add the server variables and `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (baked into the web bundle at build time) under Project Settings → Environment Variables.
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

## Known limitations

- US SEC registrants only (ticker → CIK via SEC's ticker list).
- Some companies (e.g. JPM, PFE, CVX) put MD&A in a separate annual-report exhibit; the outlook section then says "not available".
- Companies with a new SEC registration and no 10-K yet (e.g. ExxonMobil's 2026 holding company) get a briefing without filing text.
- Very long Risk Factors sections are truncated at 120k characters; the agent is told when this happens.
- AI-generated content for internal advisor use only; not investment advice.
