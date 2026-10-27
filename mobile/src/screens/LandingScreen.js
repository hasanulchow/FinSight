import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { alpha, makeStyles, useTheme } from "../theme";
import { Button, Logo, Pill } from "../components/ui";
import CandleChart from "../components/CandleChart";
import PayoffChart from "../components/PayoffChart";
import Heatmap from "../components/Heatmap";

// Public landing page (web, signed out). All charts here are illustrative, generated on the client
// and labeled as examples: the landing page never shows made-up numbers as real market data.

const FEATURES = [
  { hue: "violet", icon: "chatbubbles", title: "AI Copilot", text: "Ask anything. An agent with 18 tools pulls charts, filings, options, your portfolio and your journal, and sets alerts once you confirm." },
  { hue: "emerald", icon: "journal", title: "Journal + AI coach", text: "Log trades with your setup and mood. See win rate, expectancy and drawdown, spot revenge trades and wash sales, and get coached on your leaks." },
  { hue: "orange", icon: "calculator", title: "Position sizer", text: "Know exactly how many shares to buy so a stop-out costs 1% of your account, with ATR and support-based stops." },
  { hue: "rose", icon: "flag", title: "Red-flag radar", text: "Dilution, offerings, going-concern warnings, delisting notices and auditor changes, flagged from SEC filings before you buy." },
  { hue: "indigo", icon: "sparkles", title: "AI stock briefings", text: "Eight specialist agents read the quote, the chart, SEC financials and the latest 10-K, then write a briefing you can read in two minutes." },
  { hue: "sky", icon: "analytics", title: "Technical analysis", text: "Candles, moving averages, RSI, MACD, Bollinger Bands, support and resistance, with an AI that explains what the chart is saying." },
  { hue: "cyan", icon: "options", title: "Options center", text: "Implied vs historical volatility, expected move, probabilities and a strategy builder with payoff charts for 10 strategies." },
  { hue: "orange", icon: "flask", title: "Strategy backtester", text: "Test crossovers, RSI, MACD and breakout rules on real history against buy-and-hold, with drawdowns and every trade." },
  { hue: "amber", icon: "notifications", title: "Smart alerts", text: "Price, RSI, crossovers, volume spikes, filings, earnings and insider buys, each explained by AI the moment it fires." },
  { hue: "teal", icon: "funnel", title: "Plain-English screener", text: "“Oversold large caps above their 200-day average.” Describe it, and AI turns it into filters across large-cap stocks." },
  { hue: "blue", icon: "pie-chart", title: "Portfolio X-ray", text: "Import a CSV and see concentration, sector exposure and chart health, and whether you're actually beating the S&P 500." },
  { hue: "pink", icon: "people", title: "Earnings & insiders", text: "Next report date, beat/miss history, an AI recap of the latest release and every Form 4 insider trade." },
];

const STEPS = [
  { icon: "search", title: "Type a ticker", text: "Any SEC-registered US company. No setup, no spreadsheets." },
  { icon: "git-network", title: "Agents go to work", text: "Market, fundamentals, filings, risk and technical analysts run in parallel." },
  { icon: "shield-checkmark", title: "Reviewed and scored", text: "A compliance reviewer and an independent judge check every briefing before you read it." },
];

const TRUST = [
  { icon: "document-text", title: "Grounded in filings", text: "Financials come straight from SEC XBRL data, and answers cite the exact 10-K passage." },
  { icon: "shield-checkmark", title: "Guardrails built in", text: "Prompt-injection blocking, personal-data redaction and a compliance pass on every output." },
  { icon: "ribbon", title: "Quality you can see", text: "Each briefing shows its accuracy, completeness and compliance scores, plus automated checks." },
  { icon: "school", title: "Education, not advice", text: "Neutral, explainable research. FinSight never tells you to buy or sell." },
];

const FAQ = [
  ["Where does the data come from?", "Quotes and fundamentals from Finnhub, price history and options data from Massive (formerly Polygon.io), and company filings directly from SEC EDGAR."],
  ["Is this investment advice?", "No. FinSight explains data and filings in plain language. It never recommends buying, selling or holding, and every screen says so."],
  ["How accurate are the AI briefings?", "Numbers come from code, not the AI. Each briefing is checked for quotes that really appear in the filing and numbers that match the source data, then scored by an independent AI judge."],
  ["What does it cost?", "FinSight is free to start, with daily limits on the AI features. Pro raises every limit (300 Copilot messages a day, 40 briefings, 100 alerts), and you can cancel anytime."],
  ["Will the Copilot trade or change things on its own?", "No. It can't place trades, and anything it wants to change in your account, like an alert or a journal entry, waits for you to tap Confirm."],
  ["Does it work on my phone?", "Yes. FinSight runs on iOS, Android and the web, with push notifications for alerts on mobile."],
];

// ---------- Illustrative data (deterministic, clearly labeled) ----------
function exampleCandles() {
  let p = 182;
  const out = [];
  for (let i = 0; i < 260; i++) {
    const drift = 0.0011 + 0.012 * Math.sin(i / 17) * 0.4 + 0.006 * Math.sin(i / 5.3);
    const o = p;
    p = p * (1 + drift + 0.004 * Math.cos(i * 1.7));
    const h = Math.max(o, p) * (1 + 0.006 + 0.003 * Math.abs(Math.sin(i)));
    const l = Math.min(o, p) * (1 - 0.006 - 0.003 * Math.abs(Math.cos(i)));
    out.push({ t: Date.UTC(2025, 0, 2) + i * 86_400_000, o, h, l, c: p, v: 4e7 * (1 + 0.5 * Math.abs(Math.sin(i / 3))) });
  }
  const closes = out.map((b) => b.c);
  const sma = (n, i) => (i >= n - 1 ? closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n : null);
  let gain = 0, loss = 0;
  return out.map((b, i) => {
    if (i > 0) {
      const d = closes[i] - closes[i - 1];
      gain = (gain * 13 + Math.max(d, 0)) / 14;
      loss = (loss * 13 + Math.max(-d, 0)) / 14;
    }
    const m20 = sma(20, i);
    const sd = m20 ? Math.sqrt(closes.slice(i - 19, i + 1).reduce((s, x) => s + (x - m20) ** 2, 0) / 20) : null;
    const r = (x) => (x == null ? null : Number(x.toFixed(2)));
    return { ...b, o: r(b.o), h: r(b.h), l: r(b.l), c: r(b.c), sma50: r(sma(50, i)), sma200: r(sma(200, i)), bbUpper: r(m20 && m20 + 2 * sd), bbLower: r(m20 && m20 - 2 * sd), rsi: i > 14 && loss ? r(100 - 100 / (1 + gain / loss)) : null };
  });
}

function bsPrice(type, S, K, T, sigma, r = 0.04) {
  const erf = (x) => {
    const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
    return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
  };
  const N = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return type === "call" ? S * N(d1) - K * Math.exp(-r * T) * N(d2) : K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
}

function exampleCondor() {
  const S = 200, sigma = 0.28, T = 30 / 365;
  const legs = [["put", 1, 180], ["put", -1, 190], ["call", -1, 210], ["call", 1, 220]].map(([type, q, K]) => ({ type, q, K, prem: bsPrice(type, S, K, T, sigma) }));
  const payoff = (p, t) => legs.reduce((sum, l) => sum + 100 * l.q * ((t > 0 ? bsPrice(l.type, p, l.K, t, sigma) : Math.max(0, l.type === "call" ? p - l.K : l.K - p)) - l.prem), 0);
  const curve = Array.from({ length: 121 }, (_, i) => {
    const p = 165 + (70 * i) / 120;
    return { price: Number(p.toFixed(2)), expiry: Number(payoff(p, 0).toFixed(2)), today: Number(payoff(p, T * 0.6).toFixed(2)) };
  });
  const credit = -legs.reduce((sum, l) => sum + l.q * l.prem, 0);
  return { curve, breakevens: [Number((190 - credit).toFixed(2)), Number((210 + credit).toFixed(2))], move: { low: 184, high: 216 } };
}

const EXAMPLE_TILES = [
  ["AAPL", "Technology", 1.2, 3.4], ["MSFT", "Technology", 0.8, 3.1], ["NVDA", "Semiconductors", 2.6, 2.9], ["AVGO", "Semiconductors", -0.9, 1.1],
  ["AMD", "Semiconductors", 3.1, 0.4], ["GOOGL", "Media", 0.4, 2.1], ["META", "Media", -1.4, 1.5], ["AMZN", "Retail", 1.7, 2.0],
  ["WMT", "Retail", 0.3, 0.7], ["COST", "Retail", -0.6, 0.4], ["JPM", "Banking", -1.1, 0.7], ["BAC", "Banking", -2.2, 0.3],
  ["V", "Financial Services", 0.6, 0.6], ["MA", "Financial Services", 0.9, 0.5], ["LLY", "Pharmaceuticals", -2.8, 0.8], ["JNJ", "Pharmaceuticals", 0.2, 0.4],
  ["XOM", "Energy", 2.2, 0.5], ["CVX", "Energy", 1.5, 0.3],
].map(([ticker, sector, change_pct, weight]) => ({ ticker, sector, change_pct, weight }));

// ---------- Page ----------
export default function LandingScreen({ onStart, onOpenLegal }) {
  const { c } = useTheme();
  const s = useStyles();
  const { width } = useWindowDimensions();
  const wide = width >= 980;
  const medium = width >= 640;
  const scroller = useRef(null);
  const anchors = useRef({});
  const [openFaq, setOpenFaq] = useState(0);
  const candles = useMemo(exampleCandles, []);
  const condor = useMemo(exampleCondor, []);
  const scrollTo = (key) => scroller.current?.scrollTo({ y: Math.max(0, (anchors.current[key] ?? 0) - 72), animated: true });
  const anchor = (key) => (e) => (anchors.current[key] = e.nativeEvent.layout.y);
  const cols = wide ? 4 : medium ? 2 : 1;

  return (
    <View style={s.page}>
      {/* Navigation */}
      <View style={s.nav}>
        <View style={s.navInner}>
          <Logo size={32} />
          {wide && (
            <View style={s.navLinks}>
              {[["features", "Features"], ["how", "How it works"], ["options", "Options"], ["trust", "Trust"], ["faq", "FAQ"]].map(([k, label]) => (
                <Pressable key={k} onPress={() => scrollTo(k)} style={({ hovered }) => [s.navLink, hovered && { backgroundColor: c.surfaceAlt }]}>
                  <Text style={s.navLinkText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={s.navCtas}>
            <Button title="Sign in" variant="ghost" size="sm" onPress={() => onStart("signin")} />
            <Button title="Get started" size="sm" iconRight="arrow-forward" onPress={() => onStart("signup")} />
          </View>
        </View>
      </View>

      <ScrollView ref={scroller} contentContainerStyle={{ paddingBottom: 0 }}>
        {/* Hero */}
        <View style={s.heroWrap}>
          <LinearGradient colors={[alpha(c.brand[0], c.dark ? 0.28 : 0.14), alpha(c.brand[1], c.dark ? 0.12 : 0.06), alpha(c.brand[2], 0)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroGlow} />
          <View style={[s.container, s.hero, wide && { flexDirection: "row", alignItems: "center", gap: 48 }]}>
            <View style={[wide && { flex: 1.05 }]}>
              <View style={s.eyebrow}>
                <View style={s.eyebrowDot} />
                <Text style={s.eyebrowText}>An AI research team in your pocket</Text>
              </View>
              <Text style={[s.h1, !medium && { fontSize: 40, lineHeight: 46 }]}>
                Understand any stock <Text style={{ color: c.primary }}>in 60 seconds.</Text>
              </Text>
              <Text style={s.lead}>
                FinSight's eight AI agents read the live quote, the chart, SEC financials and the latest 10-K, then hand you a clear, cited briefing. Ask the Copilot anything, journal your trades with an AI coach, and size every position to your risk.
              </Text>
              <View style={s.ctaRow}>
                <Button title="Create your account" size="lg" iconRight="arrow-forward" onPress={() => onStart("signup")} />
                <Button title="Sign in" size="lg" variant="ghost" onPress={() => onStart("signin")} />
              </View>
              <View style={s.trustRow}>
                {[["document-text-outline", "SEC filings"], ["pulse-outline", "Real market data"], ["link-outline", "Cited answers"], ["shield-checkmark-outline", "Guardrails"]].map(([icon, label]) => (
                  <View key={label} style={s.trustItem}>
                    <Ionicons name={icon} size={15} color={c.gain} />
                    <Text style={s.trustText}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Product preview */}
            <View style={[s.preview, wide ? { flex: 1 } : { marginTop: 40 }]}>
              <View style={s.previewTop}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[s.tickerBadge, { backgroundColor: c.primarySoft }]}><Text style={[s.tickerBadgeText, { color: c.primary }]}>XMPL</Text></View>
                  <View>
                    <Text style={s.previewTitle}>Example Corp.</Text>
                    <Text style={s.previewSub}>Illustrative example · not real data</Text>
                  </View>
                </View>
                <Pill text="Bullish setup" color={c.gain} icon="trending-up" />
              </View>
              <CandleChart data={candles} />
              <View style={s.previewAi}>
                <Ionicons name="sparkles" size={14} color={c.primary} />
                <Text style={s.previewAiText}>
                  <Text style={{ fontWeight: "800", color: c.text }}>AI chart read: </Text>
                  price is above its 50- and 200-day averages with momentum firm but not overbought. Traders often watch the nearest resistance for a breakout.
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Numbers that describe the product */}
        <View style={[s.container, s.stats, !medium && { flexWrap: "wrap" }]}>
          {[["8", "specialist AI agents"], ["10", "options strategies"], ["12", "alert types"], ["5", "backtest strategies"]].map(([n, label]) => (
            <View key={label} style={[s.statBox, !medium && { flexBasis: "45%" }]}>
              <Text style={s.statNumber}>{n}</Text>
              <Text style={s.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Features */}
        <View onLayout={anchor("features")} style={[s.container, s.section]}>
          <Text style={s.kicker}>Everything in one place</Text>
          <Text style={s.h2}>Research tools that used to need a terminal</Text>
          <Text style={s.sectionLead}>From a 60-second briefing to options payoffs and backtests, FinSight puts professional-grade analysis in plain English.</Text>
          <View style={s.grid}>
            {FEATURES.map((f) => (
              <View key={f.title} style={[s.feature, { width: cols === 1 ? "100%" : `${100 / cols - 1.6}%` }]}>
                <View style={[s.featureIcon, { backgroundColor: c.soft(c.hue(f.hue)) }]}>
                  <Ionicons name={`${f.icon}-outline`} size={22} color={c.hue(f.hue)} />
                </View>
                <Text style={s.featureTitle}>{f.title}</Text>
                <Text style={s.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* How it works */}
        <View onLayout={anchor("how")} style={[s.band]}>
          <View style={[s.container, s.section]}>
            <Text style={s.kicker}>How it works</Text>
            <Text style={s.h2}>From ticker to briefing in three steps</Text>
            <View style={[s.steps, medium && { flexDirection: "row" }]}>
              {STEPS.map((st, i) => (
                <View key={st.title} style={[s.step, medium && { flex: 1 }]}>
                  <View style={s.stepTop}>
                    <LinearGradient colors={c.brand.slice(0, 2)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.stepIcon}>
                      <Ionicons name={st.icon} size={20} color="#FFFFFF" />
                    </LinearGradient>
                    <Text style={s.stepNum}>0{i + 1}</Text>
                  </View>
                  <Text style={s.featureTitle}>{st.title}</Text>
                  <Text style={s.featureText}>{st.text}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Showcase: options */}
        <View onLayout={anchor("options")} style={[s.container, s.section, wide && { flexDirection: "row", gap: 48, alignItems: "center" }]}>
          <View style={[wide && { flex: 1 }]}>
            <Text style={s.kicker}>Options, explained</Text>
            <Text style={s.h2}>See exactly how a trade makes or loses money</Text>
            <Text style={s.sectionLead}>Pick a strategy and FinSight builds it around today's price: payoff at expiration and today, breakevens, max profit and loss, probability of profit and position greeks. AI flags risks like earnings before expiry.</Text>
            {["Implied vs historical volatility and the expected move", "Probability of finishing above support and resistance", "Covered calls, spreads, straddles, iron condors and more"].map((t) => (
              <View key={t} style={s.check}>
                <Ionicons name="checkmark-circle" size={18} color={c.gain} />
                <Text style={s.checkText}>{t}</Text>
              </View>
            ))}
          </View>
          <View style={[s.preview, wide ? { flex: 1 } : { marginTop: 28 }]}>
            <View style={s.previewTop}>
              <View>
                <Text style={s.previewTitle}>Iron condor · 30 days</Text>
                <Text style={s.previewSub}>Illustrative example at 28% implied volatility</Text>
              </View>
              <Pill text="Range-bound" color={c.hue("cyan")} />
            </View>
            <PayoffChart curve={condor.curve} spot={200} breakevens={condor.breakevens} expectedMove={condor.move} />
          </View>
        </View>

        {/* Showcase: markets + backtests */}
        <View style={s.band}>
          <View style={[s.container, s.section, wide && { flexDirection: "row-reverse", gap: 48, alignItems: "center" }]}>
            <View style={[wide && { flex: 1 }]}>
              <Text style={s.kicker}>Markets at a glance</Text>
              <Text style={s.h2}>The whole market, then the details</Text>
              <Text style={s.sectionLead}>Indices, sectors, breadth across thousands of stocks, top movers and a large-cap heatmap. Tap anything to open its chart, technicals, options and insider activity.</Text>
              {["Compare up to five tickers on one chart", "Backtest a rule on real history in one tap", "Alerts that explain themselves when they fire"].map((t) => (
                <View key={t} style={s.check}>
                  <Ionicons name="checkmark-circle" size={18} color={c.gain} />
                  <Text style={s.checkText}>{t}</Text>
                </View>
              ))}
            </View>
            <View style={[s.preview, wide ? { flex: 1 } : { marginTop: 28 }]}>
              <View style={s.previewTop}>
                <Text style={s.previewTitle}>Market heatmap</Text>
                <Text style={s.previewSub}>Illustrative example</Text>
              </View>
              <Heatmap tiles={EXAMPLE_TILES} />
            </View>
          </View>
        </View>

        {/* Trust */}
        <View onLayout={anchor("trust")} style={[s.container, s.section]}>
          <Text style={s.kicker}>Built to be trusted</Text>
          <Text style={s.h2}>AI you can check</Text>
          <View style={s.grid}>
            {TRUST.map((t) => (
              <View key={t.title} style={[s.feature, { width: cols === 1 ? "100%" : `${100 / Math.min(cols, 4) - 1.6}%` }]}>
                <Ionicons name={`${t.icon}-outline`} size={24} color={c.primary} />
                <Text style={[s.featureTitle, { marginTop: 12 }]}>{t.title}</Text>
                <Text style={s.featureText}>{t.text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* FAQ */}
        <View onLayout={anchor("faq")} style={[s.container, s.section, { maxWidth: 820 }]}>
          <Text style={[s.kicker, { textAlign: "center" }]}>FAQ</Text>
          <Text style={[s.h2, { textAlign: "center" }]}>Questions, answered</Text>
          <View style={{ marginTop: 20 }}>
            {FAQ.map(([q, a], i) => (
              <Pressable key={q} onPress={() => setOpenFaq(openFaq === i ? -1 : i)} style={s.faq}>
                <View style={s.faqHead}>
                  <Text style={s.faqQ}>{q}</Text>
                  <Ionicons name={openFaq === i ? "remove" : "add"} size={20} color={c.textSecondary} />
                </View>
                {openFaq === i && <Text style={s.faqA}>{a}</Text>}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Final CTA */}
        <View style={[s.container, { paddingBottom: 64 }]}>
          <LinearGradient colors={c.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.cta}>
            <Text style={s.ctaTitle}>Your next research session starts here.</Text>
            <Text style={s.ctaText}>Create an account and brief your first stock in about a minute.</Text>
            <View style={[s.ctaRow, { justifyContent: "center" }]}>
              <Pressable onPress={() => onStart("signup")} style={({ hovered }) => [s.ctaButton, hovered && { opacity: 0.92 }]}>
                <Text style={s.ctaButtonText}>Get started</Text>
                <Ionicons name="arrow-forward" size={18} color="#1E1B4B" />
              </Pressable>
            </View>
          </LinearGradient>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <View style={[s.container, s.footerInner]}>
            <Logo size={26} nameSize={16} />
            <Text style={s.footerText}>
              FinSight provides educational research generated by AI from market data and public SEC filings. It is not investment advice or a recommendation to buy, sell or hold any security. Data may be delayed or contain errors; verify before acting. Options involve substantial risk.
            </Text>
            <View style={{ flexDirection: "row", gap: 18, flexWrap: "wrap" }}>
              {[["terms", "Terms"], ["privacy", "Privacy"], ["disclaimer", "Risk disclaimer"]].map(([k, label]) => (
                <Text key={k} style={[s.footerText, { color: c.textSecondary, fontWeight: "600" }]} onPress={() => onOpenLegal?.(k)}>{label}</Text>
              ))}
            </View>
            <Text style={s.footerText}>© {new Date().getFullYear()} FinSight</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  page: { flex: 1, backgroundColor: c.bg },
  container: { width: "100%", maxWidth: 1160, alignSelf: "center", paddingHorizontal: 22 },
  nav: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.bg, zIndex: 10 },
  navInner: { width: "100%", maxWidth: 1160, alignSelf: "center", paddingHorizontal: 22, height: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navLinks: { flexDirection: "row", gap: 2 },
  navLink: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  navLinkText: { color: c.textSecondary, fontWeight: "600", fontSize: 14 },
  navCtas: { flexDirection: "row", gap: 8, alignItems: "center" },
  heroWrap: { overflow: "hidden" },
  heroGlow: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  hero: { paddingTop: 72, paddingBottom: 72 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  eyebrowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.gain },
  eyebrowText: { color: c.textSecondary, fontSize: 13, fontWeight: "600" },
  h1: { color: c.text, fontSize: 58, lineHeight: 64, fontWeight: "800", letterSpacing: -1.8, marginTop: 22 },
  lead: { color: c.textSecondary, fontSize: 18, lineHeight: 28, marginTop: 20, maxWidth: 600 },
  ctaRow: { flexDirection: "row", gap: 12, marginTop: 30, flexWrap: "wrap" },
  trustRow: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: 28 },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  trustText: { color: c.textSecondary, fontSize: 13, fontWeight: "600" },
  preview: { backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 18, shadowColor: c.shadow, shadowOpacity: c.dark ? 0.5 : 0.12, shadowRadius: 40, shadowOffset: { width: 0, height: 20 }, elevation: 8 },
  previewTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10 },
  tickerBadge: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tickerBadgeText: { fontWeight: "800", fontSize: 12 },
  previewTitle: { color: c.text, fontWeight: "800", fontSize: 16 },
  previewSub: { color: c.muted, fontSize: 12, marginTop: 1 },
  previewAi: { flexDirection: "row", gap: 8, backgroundColor: c.primarySoft, borderRadius: 14, padding: 12, marginTop: 12 },
  previewAiText: { flex: 1, color: c.textSecondary, fontSize: 13, lineHeight: 19 },
  stats: { flexDirection: "row", gap: 12, paddingVertical: 8 },
  statBox: { flex: 1, backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 20, alignItems: "center" },
  statNumber: { color: c.text, fontSize: 36, fontWeight: "800", letterSpacing: -1 },
  statLabel: { color: c.textSecondary, fontSize: 13, marginTop: 2, textAlign: "center" },
  section: { paddingVertical: 72 },
  band: { backgroundColor: c.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border },
  kicker: { color: c.primary, fontWeight: "700", fontSize: 13, letterSpacing: 0.8, textTransform: "uppercase" },
  h2: { color: c.text, fontSize: 36, lineHeight: 42, fontWeight: "800", letterSpacing: -1, marginTop: 10, maxWidth: 720 },
  sectionLead: { color: c.textSecondary, fontSize: 17, lineHeight: 26, marginTop: 14, maxWidth: 640 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 36 },
  feature: { backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 22 },
  featureIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  featureTitle: { color: c.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  featureText: { color: c.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 6 },
  steps: { gap: 16, marginTop: 36 },
  step: { backgroundColor: c.bg, borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 22 },
  stepTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  stepIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepNum: { color: c.borderStrong, fontSize: 28, fontWeight: "800" },
  check: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  checkText: { color: c.text, fontSize: 15, flex: 1 },
  faq: { borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 18 },
  faqHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  faqQ: { color: c.text, fontSize: 17, fontWeight: "700", flex: 1 },
  faqA: { color: c.textSecondary, fontSize: 15, lineHeight: 23, marginTop: 10 },
  cta: { borderRadius: 28, padding: 48, alignItems: "center" },
  ctaTitle: { color: "#FFFFFF", fontSize: 34, fontWeight: "800", letterSpacing: -0.8, textAlign: "center" },
  ctaText: { color: "rgba(255,255,255,0.85)", fontSize: 17, marginTop: 10, textAlign: "center" },
  ctaButton: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFFFFF", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 16 },
  ctaButtonText: { color: "#1E1B4B", fontWeight: "800", fontSize: 16 },
  footer: { borderTopWidth: 1, borderTopColor: c.border, paddingVertical: 36 },
  footerInner: { gap: 14 },
  footerText: { color: c.muted, fontSize: 12, lineHeight: 18, maxWidth: 820 },
}));
