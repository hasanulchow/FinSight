# FinSight: AI stock research for traders and investors

Type a ticker and get an AI briefing in about a minute: live quote, chart and technical analysis, multi-year financials from SEC XBRL data, business and risk summaries from the latest 10-K, earnings and insider activity, and talking points. Ask the **Copilot**, an AI agent that uses 18 FinSight tools and proposes alerts, holdings and journal entries for you to confirm. Keep a **trade journal** with an AI coach, size positions to your risk, compare your portfolio with SPY, and scan any stock for red flags. Add smart alerts, a natural-language screener and a Portfolio X-ray. Every weekday morning an agent briefs you on what changed for your stocks and re-checks your investment theses. Free and Pro plans (with a free trial), billed with Stripe. Works on iPhone, iPad, Android and the web. Every briefing is checked by compliance guardrails and scored by an LLM judge plus automated checks.

**Stack:** React Native (Expo) · Node.js (Express) · Claude Sonnet 5.5 · Supabase (Postgres + Auth) · SEC EDGAR · Finnhub · Massive (prices) · Voyage AI (embeddings) · Render or Vercel

## Architecture

```
Expo app ──(Supabase JWT)──► Node API on Render ──► SEC EDGAR, Finnhub (data tools)
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

## Trading features (v1.2)

The app has five tabs (**Research, Markets, Screener, Portfolio, Alerts**) and runs on iOS, Android and the web.

| Feature | What it does | Where |
|---|---|---|
| **AI technical analysis** | Candlestick chart (SMA 50/200, Bollinger Bands, volume, RSI panel, 1M–1Y, touch to inspect). Indicators computed in code: SMA/EMA, RSI(14), MACD, Bollinger, ATR, stochastic, OBV, support/resistance, trend, crossovers, rule-based rating. The **Technical Analyst** (8th agent) explains them. | `lib/indicators.js`, `agents/technicalAnalyst.js`, `tools/prices.js` |
| **Smart alerts** | Price, RSI, golden/death cross, MACD cross, volume spike, new SEC filing, earnings within 3 days, insider buy. A scheduled job checks them; when one fires, AI explains why it may matter, and you get an in-app notification plus a push. | `lib/alerts.js`, `lib/notify.js`, `lib/jobs.js` |
| **Natural-language screener** | "Oversold large caps above their 200-day average": Claude turns it into filters, code applies them to ~100 large caps, and AI notes each match. | `lib/screener.js` |
| **Earnings & smart money** | Next earnings date, EPS beat/miss history, AI preview and recap of the latest earnings release (8-K 2.02), and insider trades parsed from SEC Form 4 with net buying/selling stats. | `lib/events.js`, `agents/eventsAnalyst.js` |
| **Portfolio X-ray** | CSV import (broker exports or `AAPL,10,150` lines) or manual entry: value, day change, P/L, sector weights, concentration (effective number of holdings), chart health per holding, upcoming earnings, AI analysis, and a daily digest notification. | `lib/portfolio.js` |

Plus **Ask the 10-K** (cited Q&A with conversation memory) and a "Since your last look" section in repeat briefings.

### Options, backtesting and markets (v1.3)

| Feature | What it does | Where |
|---|---|---|
| **Options center** | Implied vs historical volatility (20/60-day), IV regime, earnings-before-expiry warning, expected move with a range bar, and the probability of finishing above key support/resistance levels. Includes an option chain (price, delta, probability ITM, IV), plus put/call ratios and max pain when open-interest data is available. | `lib/options.js`, `lib/optionsMath.js` |
| **Strategy builder** | 10 templates: long call or put, covered call, cash-secured put, protective put, bull call and bear put spreads, straddle, strangle, iron condor. Each shows a payoff chart (at expiration and today), breakevens, max profit and loss, probability of profit, net debit or credit, and position greeks. The **Options Analyst** agent explains the volatility picture and the strategy's risks. | `optionsMath.analyzeStrategy`, `agents/optionsAnalyst.js` |
| **Backtester** | MA crossover, RSI mean reversion, MACD crossover, Donchian breakout and 200-day trend filter, with editable parameters. Signals fill at the next open with 5 bps costs. Shows an equity curve and drawdowns vs buy-and-hold, plus return, CAGR, max drawdown, Sharpe, win rate, exposure and the trade list. | `lib/backtest.js` |
| **Markets tab** | Index ETFs (SPY, QQQ, DIA, IWM), 11 sector ETFs, breadth (advancers vs decliners across ~5,000 stocks), a large-cap heatmap, top gainers, losers and most active, and a multi-ticker performance comparison chart. | `lib/market.js` |

**Options data:**
- **Free plan:** Massive provides contracts and per-contract daily prices. The app prices the at-the-money call and put, solves for implied volatility, and models every strike with Black-Scholes at that volatility. The model reproduced AAPL's market ATM prices to within $0.03.
- **Paid options plan:** the app automatically uses the live chain snapshot instead (bid/ask, per-strike IV, greeks, open interest).

The first options or markets request for a symbol can take up to a minute on the free tier (5 calls/minute). Results are cached for everyone in `kv_cache` (options 6 hours, market snapshot 3 hours).

**Market data:** price history comes from [Massive](https://massive.com) (formerly Polygon.io). Bars are cached per ticker in `price_bars` because the free tier allows about 5 calls a minute; a paid plan makes the screener universe and alerts faster. Without `MASSIVE_API_KEY`, briefings still work, just without technicals. Institutional (13F) holdings need a paid data source and aren't included.

**Scheduled jobs:** alerts, the screener refresh (`SCREENER_BATCH` tickers per run) and daily digests (after 21:00 UTC) run through `runJobs()`:
- **Render or local:** set `JOBS_INTERVAL_MINUTES=10`.
- **Vercel:** `vercel.json` defines two weekday crons calling `/jobs/run` (12:00 UTC for thesis checks and morning briefs, 21:30 UTC for digests), authorized by `CRON_SECRET`. Automations run on whichever job fires next after their time, so on Vercel Hobby they are effectively twice a day; Render with `JOBS_INTERVAL_MINUTES=10` runs them on time.

### Agentic SaaS layer (v1.4)

| Feature | What it does | Where |
|---|---|---|
| **AI Copilot** | A chat agent with 18 tools: quotes and technicals, earnings and insiders, red flags, the 10-K, options and strategies, backtests, screener, market overview, your portfolio and benchmark, your journal, position sizing and alerts. Independent tool calls run in parallel, for up to 8 steps per turn. Each answer shows which tools ran. Write tools (`create_alert`, `add_holding`, `log_trade`) only **propose** a change; it happens when the user taps Confirm. | `lib/copilot.js` |
| **Trade journal + AI coach** | Log trades by hand, or import a CSV, tagged with setup and emotion. Stats: win rate, profit factor, expectancy, average R, drawdown, streaks, hold times, realized P/L this year, and an equity curve. Breakdowns by emotion, setup, ticker and weekday. Flags trades placed right after a loss (revenge trading) and possible **wash sales**. The coach agent turns the stats into strengths, costly leaks and rules to try. | `lib/journal.js` |
| **Position sizer** | Shares to buy so a stop-out loses only X% of the account. The stop comes from you, 2× ATR, or nearest support/resistance. Also shows a max-position cap and 1R/2R/3R targets. | `lib/risk.js` |
| **Portfolio vs SPY** | Return, volatility, max drawdown, Sharpe, beta and correlation of your current holdings against SPY over 3 months to 2 years. | `risk.benchmarkPortfolio` |
| **Red-flag radar** | Checks for sub-$1 and penny stocks, micro-caps, extreme volatility, share dilution, S-1/S-3/424B offerings, 8-K delisting notices, auditor changes, restatements, late filings, short cash runway and going-concern language. Each flag comes with evidence. | `lib/redflags.js` |
| **Plans, quotas and billing** | Free and Pro plans with daily AI quotas (`usage_events`) and caps on alerts, holdings and trades. Hitting a limit returns HTTP 402 with `upgrade: true`, and the app shows an upgrade prompt. Stripe Checkout, the customer portal and a signed webhook keep `subscriptions` in sync. | `lib/plans.js`, `lib/billing.js`, `routes/saas.js` |

**Billing setup (optional):**
1. In Stripe, create a recurring Price for Pro.
2. Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO` and `APP_URL`.
3. Add a webhook to `<APP_URL>/billing/webhook` for `checkout.session.completed` and `customer.subscription.created/updated/deleted`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`.

Without Stripe keys, everyone stays on Free and upgrades are hidden. In local mode, `DEV_PLAN=free|pro` picks the plan (default `pro`).

### Proactive agent, discipline tools and launch basics (v1.5)

| Feature | What it does | Where |
|---|---|---|
| **Morning brief** | Every weekday before the open (11:00 to 15:00 UTC), an agent reviews every stock you own or watch: price moves, trend, earnings within 7 days, new SEC filings, insider trades in the last 3 days, red flags and thesis status. It writes what changed and why it matters, then sends a push notification. The **Today** tab shows the brief and can refresh it on demand. | `lib/brief.js` |
| **Thesis tracker** | Each watchlist stock can carry a one-line thesis. An agent checks it daily against the evidence: price action, fundamentals, earnings, insiders, filings and red flags. It rates the thesis intact, watch, weakening or broken, and notifies you when it gets worse. | `lib/watchlist.js` |
| **Automations** | Scheduled Copilot prompts that run daily, on weekdays or weekly at a chosen time; for example, "Every Friday, check my watchlist for oversold names." Each run continues its own conversation and sends you the answer. | `lib/tasks.js` |
| **Pre-trade checklist** | Your own rules, for example: always set a stop, wait N days after a loss, max risk %, max position %, no trades before earnings, blocked emotions, and minimum reward:risk. New journal trades are checked against them, and a broken rule shows the checklist with a "Log it anyway" button. The coach's suggested rules can be turned into checklist rules. | `lib/rules.js` |
| **Option P/L explainer** | Answers "why did my call lose money when the stock went up?" It re-prices the option with Black-Scholes one factor at a time to split P/L into stock move, time decay and the change in implied volatility (IV crush). The parts add up exactly to the total. | `lib/optionPnl.js` |
| **Tax center** | Realized P/L this year (short vs long term, by month), possible wash sales, and tax-loss harvesting candidates among holdings, with the dates you can rebuy without a wash sale. | `lib/tax.js` |
| **Broker sync** | Read-only SnapTrade connection (Robinhood, Schwab, Fidelity, IBKR, Webull and others). It imports positions into Holdings, and turns a year of buy/sell fills into journal round trips matched first in, first out. Re-syncing doesn't create duplicates. The SnapTrade user secret is encrypted at rest (AES-256-GCM). | `lib/broker.js` |
| **Onboarding + legal** | First run asks you to accept the Terms, Privacy Policy and Risk Disclaimer (stored with the version), then your experience level, goals and a starter watchlist. The legal pages are in the app and at `/?legal=terms`. | `OnboardingScreen`, `mobile/src/lib/legal.js` |
| **Referrals + sharing** | Invite links (`/?ref=CODE`) give both people 14 days of Pro. Share links (`/?share=TOKEN`) publish a snapshot of a briefing or your journal stats, with no dollar amounts or identity. | `lib/account.js`, `lib/shares.js` |
| **Free trial, account deletion** | The first Pro checkout includes a `TRIAL_DAYS` trial (default 7). Deleting your account cancels Stripe, disconnects the broker, deletes all rows and removes the login. | `lib/billing.js`, `lib/account.js` |
| **Analytics + admin** | Optional server-side PostHog events (`POSTHOG_KEY`). Every Claude call is logged to `ai_usage` with its cost (via AsyncLocalStorage, so no ids are passed around). Admins (`ADMIN_EMAILS`) get a business dashboard: users, active users, MRR, conversion, AI cost per agent and per user, gross margin, and signups. | `lib/analytics.js`, `lib/aiUsage.js`, `lib/admin.js` |
| **iPad and tablets** | At 768pt and wider, any platform (iPad, Android tablets, desktop web) uses the sidebar layout. The app rotates (`orientation: default`), supports iPad Split View (`requireFullScreen: false`), and every modal allows landscape. Sheets become centered dialogs on tablets. | `App.js`, `app.json`, `components/Sheet.js` |

The legal texts are starting templates written for FinSight's actual features. Have a lawyer review them, and fill in your company details, before charging customers.

## Setup

**Requirements:** Node.js 22 or later (Expo SDK 58 and supabase-js need it), and the Expo Go app on your phone.

### 1. Supabase
1. Create a project at supabase.com.
2. In the SQL editor, run `supabase/schema.sql`, then `supabase/002_memory_guardrails_embeddings.sql` (pgvector, memory, chat, guardrail log), then `supabase/003_trading_features.sql` (price cache, alerts, notifications, push tokens, screener, earnings cache, holdings), then `supabase/004_options_markets.sql` (shared cache for options and market data), then `supabase/005_copilot_journal_billing.sql` (journal, Copilot, plans, usage and subscriptions), then `supabase/006_proactive_growth.sql` (settings and onboarding, watchlist and theses, morning briefs, automations, broker connections, AI cost log, share links).
3. Authentication → Providers → Email: enabled. For a quick demo, turn off "Confirm email".
4. Authentication → URL Configuration: set Site URL to your deployed URL (e.g. `https://finsight.onrender.com`) and add it plus `http://localhost:3001` under Redirect URLs, so confirmation emails link back to the app.
5. Project Settings → API: copy the URL, the anon key and the service-role key.

### 2. API keys
- Anthropic: console.anthropic.com → API keys
- Finnhub: finnhub.io (free tier)
- Voyage AI (optional, for vector search): dash.voyageai.com
- Massive, formerly Polygon.io (for charts, technicals, screener and indicator alerts): massive.com

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

- **Web app + API → Render (one service, recommended):** push to GitHub, then on render.com choose New → Blueprint and select the repo (`render.yaml`). Fill in the secrets when prompted: the server keys plus `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`, which are baked into the web bundle at build time (change them → Manual Deploy → Clear build cache & deploy). The build exports the Expo web app to `mobile/dist` and Express serves it on the same origin as the API. The blueprint uses the Starter plan because agents run after the response returns and a sleeping free instance can cut a briefing off. Local mode never turns on on Render (`RENDER` is set), so missing Supabase keys fail closed.
- **Alternative: Vercel (one project):** import the GitHub repo on vercel.com and keep the root directory as the repo root; `vercel.json` sets everything else. The build exports the Expo web app to `mobile/dist` (served from Vercel's CDN), and `api/index.js` runs the Express API as a serverless function. `/health`, `/briefings/*`, `/memory/*` and `/evals/*` are rewritten to it, so the app and API share one origin and `EXPO_PUBLIC_API_URL` isn't needed for web. Add the server variables and `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (baked into the web bundle at build time) under Project Settings → Environment Variables.
- **Background agents on Vercel:** `POST /briefings` responds immediately and keeps the function alive with `waitUntil` until the agents finish, up to `maxDuration` (300 s in `vercel.json`, which needs Fluid compute: on by default for new projects).
- **iOS and Android apps:** set `EXPO_PUBLIC_API_URL` to your deployed URL in `mobile/.env`.
  - **Quick demo:** use Expo Go (`npx expo start`), which covers everything except remote push.
  - **Installable builds with push:**
    ```bash
    npm install -g eas-cli
    cd mobile && eas init               # creates the EAS project id that push tokens need
    eas build --profile preview         # installable iOS/Android test builds
    eas build --profile production && eas submit   # App Store / Google Play
    ```
    Bundle id and package are `com.finsight.app` (`app.json`); change them to your own before publishing.

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
| POST | `/copilot/chat` | `{ message, conversation_id? }` → `{ conversation_id, message, actions, trace }` |
| GET | `/copilot/conversations`, `/copilot/conversations/:id` | Past conversations and their messages |
| POST | `/copilot/actions/:id/confirm` or `/cancel` | Run or drop a change the Copilot proposed |
| GET | `/journal` | Trades (with P/L and R), stats, emotions |
| POST / PATCH / DELETE | `/journal/trades`, `/journal/trades/:id` | Add, close/edit or delete a trade |
| POST | `/journal/import`, `/journal/coach` | CSV import; AI coaching (needs 3+ closed trades) |
| POST | `/risk/position-size` | `{ account_size, risk_pct, ticker?, entry?, stop?, side?, max_position_pct? }` |
| GET | `/portfolio/benchmark?days=` | Holdings vs SPY |
| GET | `/stocks/:ticker/redflags` | Red-flag scan |
| GET | `/plans`, `/account` | Plans; the user's plan, today's usage and caps |
| POST | `/billing/checkout`, `/billing/portal`, `/billing/webhook` | Stripe Checkout, customer portal, webhook (signature-verified) |
| GET / PATCH | `/settings` | Settings, `needs_onboarding`, `is_admin`; update brief and profile preferences |
| POST | `/onboarding` | `{ accept_terms: true, experience, goals, watchlist, ref }` |
| GET | `/referrals` | Invite code, link, signups |
| DELETE | `/account` | `{ confirm: "DELETE" }`: cancels billing and deletes everything |
| GET / POST / PATCH / DELETE | `/watchlist`, `/watchlist/:id` | Watchlist and theses; `POST /watchlist/:id/check` re-checks a thesis |
| GET / POST | `/brief`, `/brief/generate` | Latest morning brief; build today's now |
| GET / POST / PATCH / DELETE | `/automations`, `/automations/:id` | Scheduled Copilot tasks; `POST /automations/:id/run` runs one now |
| GET / PUT | `/rules` | Rule definitions and the user's rules |
| POST | `/journal/precheck` | Checks a planned trade against the rules |
| POST | `/options/pnl-explain` | Option P/L split into stock move, time decay and IV |
| GET | `/tax/summary?year=` | Realized gains, wash sales, harvesting candidates |
| GET / POST / DELETE | `/broker`, `/broker/connect`, `/broker/sync` | SnapTrade status, connection portal URL, import, disconnect |
| POST | `/briefings/:id/share`, `/journal/share` | Create a public share link |
| GET | `/share/:token` | Public share snapshot (no auth) |
| POST | `/events` | Allow-listed client analytics events |
| GET | `/admin/metrics` | Business dashboard (admins only) |

## Known limitations

- US SEC registrants only (ticker → CIK via SEC's ticker list).
- Some companies (e.g. JPM, PFE, CVX) put MD&A in a separate annual-report exhibit; the outlook section then says "not available".
- Companies with a new SEC registration and no 10-K yet (e.g. ExxonMobil's 2026 holding company) get a briefing without filing text.
- Very long Risk Factors sections are truncated at 120k characters; the agent is told when this happens.
- AI-generated content for internal advisor use only; not investment advice.
