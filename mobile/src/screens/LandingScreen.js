import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { alpha, makeStyles, useTheme } from "../theme";
import { Button, Pill } from "../components/ui";
import { Logo, LogoGlyph, LogoMark } from "../components/Brand";
import NavIcon from "../components/NavIcon";
import CandleChart from "../components/CandleChart";
import PayoffChart from "../components/PayoffChart";
import Heatmap from "../components/Heatmap";
import { EXAMPLE_TILES, exampleCandles, exampleCondor } from "../landing/examples";

// Public landing page (web, signed out). Every product visual here is an illustrative mock built from
// the app's own components and clearly labeled; the page never presents made-up numbers as real data.

const STEPS = [
  ["today", "Add the stocks you care about", "Your holdings and a watchlist, each with a one-line reason you own it."],
  ["copilot", "Get briefed every morning", "Before the open, AI agents check prices, filings, earnings and insiders, and tell you what changed."],
  ["trade", "Practice, then trade with discipline", "Paper trade with $100k, follow your own rules checklist, and learn from an AI coach."],
];

const TRUST = [
  ["document-text", "Grounded in filings", "Financials come straight from SEC data, and answers cite the exact 10-K passage."],
  ["checkmark-done", "You confirm every action", "The Copilot proposes; you decide. It can never place a real trade."],
  ["shield-checkmark", "Guardrails built in", "Prompt-injection blocking, personal-data redaction and a compliance pass on every answer."],
  ["school", "Education, not advice", "Neutral, explainable research. FinSight never tells you to buy or sell."],
];

const FAQ = [
  ["Is this investment advice?", "No. FinSight explains data and filings in plain language. It never recommends buying, selling or holding, and every screen says so."],
  ["Can I trade in FinSight?", "Yes. Practice with $100,000 of paper money and live prices. Where your broker supports it, you can also place real orders in your own brokerage account; you review and confirm every order, and your money stays at your broker."],
  ["Will the AI act on its own?", "No. The Copilot can never place real trades. Anything it suggests changing, like an alert, a journal entry or a practice order, waits for you to tap Confirm."],
  ["Where does the data come from?", "Quotes and fundamentals from Finnhub, price history and options data from Massive (formerly Polygon.io), and company filings directly from SEC EDGAR."],
  ["How accurate is the AI?", "Numbers come from code, not the AI. Briefings are checked for quotes that really appear in the filing and numbers that match the source data, then scored by an independent AI judge."],
  ["What does it cost?", "Free to start, with daily limits on the AI features. Pro raises every limit and adds a free trial; cancel anytime."],
  ["Does it work on my phone and iPad?", "Yes. FinSight runs on iPhone, iPad, Android and the web, with push notifications for alerts and your morning brief."],
];

const PLANS = [
  { key: "free", name: "Free", price: { month: "$0", year: "$0" }, note: "Forever", cta: "Start free", perks: ["3 AI briefings and 15 Copilot messages a day", "Practice trading with $100k", "Trade journal, rules checklist and position sizer", "5 alerts and a 10-stock watchlist"] },
  { key: "pro", name: "Pro", price: { month: "$19", year: "$190" }, note: { month: "per month", year: "per year · 2 months free" }, cta: "Start free trial", featured: true, perks: ["40 briefings and 300 Copilot messages a day", "Morning brief and daily thesis checks", "AI journal coach, earnings companion, automations", "100 alerts, 100-stock watchlist, broker sync"] },
];

export default function LandingScreen({ onStart, onOpenLegal }) {
  const { c } = useTheme();
  const s = useStyles();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const medium = width >= 680;
  const scroller = useRef(null);
  const anchors = useRef({});
  const [openFaq, setOpenFaq] = useState(0);
  const [interval, setInterval_] = useState("year");
  const candles = useMemo(exampleCandles, []);
  const condor = useMemo(exampleCondor, []);
  const scrollTo = (key) => scroller.current?.scrollTo({ y: Math.max(0, (anchors.current[key] ?? 0) - 70), animated: true });
  const anchor = (key) => (e) => (anchors.current[key] = e.nativeEvent.layout.y);
  const tile = (span) => (wide ? { width: span === 2 ? "65.4%" : "32.2%" } : medium ? { width: "48.9%" } : { width: "100%" });

  return (
    <View style={s.page}>
      {/* ---------- Navigation ---------- */}
      <View style={s.nav}>
        <View style={s.navInner}>
          <Logo size={30} />
          {wide && (
            <View style={s.navLinks}>
              {[["product", "Product"], ["trading", "Trading"], ["pricing", "Pricing"], ["faq", "FAQ"]].map(([k, label]) => (
                <Pressable key={k} onPress={() => scrollTo(k)} style={({ hovered }) => [s.navLink, hovered && { backgroundColor: c.surfaceAlt }]}>
                  <Text style={s.navLinkText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={s.navCtas}>
            {medium && <Button title="Sign in" variant="ghost" size="sm" onPress={() => onStart("signin")} />}
            <Button title="Get started" size="sm" onPress={() => onStart("signup")} />
          </View>
        </View>
      </View>

      <ScrollView ref={scroller}>
        {/* ---------- Hero ---------- */}
        <View style={s.heroWrap}>
          <LinearGradient colors={[alpha("#5B5BF7", c.dark ? 0.32 : 0.16), alpha("#7C3AED", c.dark ? 0.14 : 0.07), alpha("#22D3EE", 0)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={s.fillAbs} />
          <View style={[s.gridBg, { opacity: c.dark ? 0.35 : 0.5 }]} pointerEvents="none" />
          <View style={[s.container, s.hero, wide && { flexDirection: "row", alignItems: "center", gap: 56 }]}>
            <View style={[wide ? { flex: 1.1 } : { alignItems: "center" }]}>
              <Pressable onPress={() => scrollTo("trading")} style={({ hovered }) => [s.announce, !wide && { alignSelf: "center" }, hovered && { borderColor: c.primary }]}>
                <View style={s.announceTag}><Text style={s.announceTagText}>New</Text></View>
                <Text style={s.announceText}>Practice trading and an AI trading coach</Text>
                <Ionicons name="arrow-forward" size={14} color={c.textSecondary} />
              </Pressable>
              <Text style={[s.h1, !wide && { textAlign: "center" }, !medium && { fontSize: 42, lineHeight: 47, letterSpacing: -1.6 }]}>
                Your AI trading desk.{"\n"}
                <Text style={s.h1Accent}>Research, practice, trade.</Text>
              </Text>
              <Text style={[s.lead, !wide && { textAlign: "center" }]}>
                A team of AI analysts reads the charts, SEC filings and earnings for every stock you follow, briefs you each morning, coaches your trading, and lets you practice with $100k before you risk a dollar.
              </Text>
              <View style={[s.ctaRow, !wide && { justifyContent: "center" }]}>
                <Pressable onPress={() => onStart("signup")} style={({ hovered, pressed }) => [s.primaryCta, hovered && { transform: [{ translateY: -1 }] }, pressed && { opacity: 0.9 }]}>
                  <LinearGradient colors={["#5B5BF7", "#7C3AED"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.primaryCtaInner}>
                    <Text style={s.primaryCtaText}>Start free</Text>
                    <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                  </LinearGradient>
                </Pressable>
                <Button title="Sign in" size="lg" variant="ghost" onPress={() => onStart("signin")} />
              </View>
              <View style={[s.trustRow, !wide && { justifyContent: "center" }]}>
                {["No credit card to start", "Cancel anytime", "iPhone, iPad, Android, web"].map((t) => (
                  <View key={t} style={s.trustItem}>
                    <Ionicons name="checkmark-circle" size={15} color={c.gain} />
                    <Text style={s.trustText}>{t}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={[wide ? { flex: 0.9, alignItems: "center" } : { marginTop: 48, alignItems: "center" }]}>
              <HeroDevice compact={!medium} />
            </View>
          </View>
        </View>

        {/* ---------- Built on ---------- */}
        <View style={[s.container, s.builtOn]}>
          <Text style={s.builtOnLabel}>Built on primary sources</Text>
          <View style={s.builtOnRow}>
            {[["business-outline", "SEC EDGAR filings"], ["pulse-outline", "Live market data"], ["layers-outline", "Options chains"], ["sparkles-outline", "Claude AI"]].map(([icon, label]) => (
              <View key={label} style={s.builtOnItem}>
                <Ionicons name={icon} size={17} color={c.textSecondary} />
                <Text style={s.builtOnText}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ---------- Product bento ---------- */}
        <View onLayout={anchor("product")} style={[s.container, s.section]}>
          <SectionHead kicker="One app, a whole research team" title="Everything a serious investor needs, explained in plain English" lead="Specialist AI agents do the reading and the math. You get clear answers, cited sources and tools that keep you disciplined." center />
          <View style={s.bento}>
            <BentoTile style={tile(2)} icon="copilot" hue="violet" title="AI Copilot" text="Ask anything about a stock, your portfolio or your trades. It uses 22 tools, shows its work, and never acts without your confirmation.">
              <CopilotMini />
            </BentoTile>
            <BentoTile style={tile(1)} icon="today" hue="amber" title="Morning brief" text="What changed overnight for every stock you own or watch, before the open.">
              <BriefMini />
            </BentoTile>
            <BentoTile style={tile(1)} icon="trade" hue="emerald" title="Practice trading" text="$100,000 of paper money, live prices, market, limit and stop orders.">
              <TradeMini />
            </BentoTile>
            <BentoTile style={tile(1)} icon="journal" hue="sky" title="Journal + AI coach" text="Win rate, expectancy and your costliest habits, with rules that fix them.">
              <CoachMini />
            </BentoTile>
            <BentoTile style={tile(1)} icon="alerts" hue="rose" title="Earnings companion" text="The move options are pricing in vs how the stock really moved after past reports.">
              <EarningsMini />
            </BentoTile>
          </View>
          <View style={s.moreFeatures}>
            {["Red-flag radar", "Thesis tracker", "Position sizer", "Options strategies", "Backtester", "Plain-English screener", "Portfolio vs S&P 500", "Tax center", "Smart alerts", "Broker sync", "Automations", "Weekly email report"].map((f) => (
              <View key={f} style={s.moreChip}>
                <Ionicons name="checkmark" size={13} color={c.primary} />
                <Text style={s.moreChipText}>{f}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ---------- Chart showcase ---------- */}
        <View style={s.band}>
          <View style={[s.container, s.section, wide && { flexDirection: "row", gap: 56, alignItems: "center" }]}>
            <View style={[wide && { flex: 0.85 }]}>
              <SectionHead kicker="Technical analysis" title="See what the chart is saying" lead="Candles, moving averages, RSI, MACD, Bollinger Bands and support and resistance, read out loud by an AI analyst, with every level it mentions on the chart." />
              <Checks items={["Rule-based signals you can audit", "Alerts on price, RSI, crossovers and volume", "Backtest a rule on real history in one tap"]} />
            </View>
            <View style={[s.showcase, wide ? { flex: 1.15 } : { marginTop: 28 }]}>
              <ShowcaseHead title="Example Corp. · XMPL" sub="Illustrative example, not real data" pill={<Pill text="Bullish setup" color={c.gain} icon="trending-up" />} />
              <CandleChart data={candles} />
              <View style={s.aiNote}>
                <NavIcon name="copilot" size={16} color={c.primary} active />
                <Text style={s.aiNoteText}><Text style={s.aiNoteStrong}>AI chart read: </Text>price is above its 50- and 200-day averages with momentum firm but not overbought. Traders often watch the nearest resistance for a breakout.</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ---------- Trading ---------- */}
        <View onLayout={anchor("trading")} style={[s.container, s.section]}>
          <SectionHead kicker="Trading" title="Practice like a pro. Trade when you're ready." lead="Start with a $100,000 practice account. When you're ready, place real orders in your own brokerage account from FinSight. Your money never leaves your broker." center />
          <View style={[s.tradeGrid, medium && { flexDirection: "row" }]}>
            {[
              ["school-outline", "Paper trading", "Market, limit and stop orders with live prices during market hours. Every closed trade lands in your journal."],
              ["list-outline", "Your rules, enforced", "Set rules like “always use a stop” or “no trades after a loss.” Every order is checked before you place it."],
              ["link-outline", "Your broker, your money", "Connect Schwab, Fidelity, IBKR and more. Review the broker's preview, then confirm. FinSight never holds funds."],
            ].map(([icon, title, text]) => (
              <View key={title} style={[s.tradeCard, medium && { flex: 1 }]}>
                <View style={s.tradeIcon}><Ionicons name={icon} size={20} color={c.primary} /></View>
                <Text style={s.cardTitle}>{title}</Text>
                <Text style={s.cardText}>{text}</Text>
              </View>
            ))}
          </View>
          <View style={[s.proRow, wide && { flexDirection: "row" }]}>
            <View style={[s.showcase, wide && { flex: 1 }]}>
              <ShowcaseHead title="Iron condor · 30 days" sub="Illustrative example at 28% implied volatility" pill={<Pill text="Range-bound" color={c.hue("cyan")} />} />
              <PayoffChart curve={condor.curve} spot={200} breakevens={condor.breakevens} expectedMove={condor.move} />
            </View>
            <View style={[s.showcase, wide ? { flex: 1 } : { marginTop: 16 }]}>
              <ShowcaseHead title="Market heatmap" sub="Illustrative example" />
              <Heatmap tiles={EXAMPLE_TILES} />
            </View>
          </View>
        </View>

        {/* ---------- How it works ---------- */}
        <View style={s.band}>
          <View style={[s.container, s.section]}>
            <SectionHead kicker="How it works" title="Five minutes a day to a sharper process" center />
            <View style={[s.steps, medium && { flexDirection: "row" }]}>
              {STEPS.map(([icon, title, text], i) => (
                <View key={title} style={[s.step, medium && { flex: 1 }]}>
                  <View style={s.stepTop}>
                    <LinearGradient colors={["#5B5BF7", "#7C3AED"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.stepIcon}>
                      <NavIcon name={icon} size={22} color="#FFFFFF" />
                    </LinearGradient>
                    <Text style={s.stepNum}>0{i + 1}</Text>
                  </View>
                  <Text style={s.cardTitle}>{title}</Text>
                  <Text style={s.cardText}>{text}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ---------- Trust ---------- */}
        <View style={[s.container, s.section]}>
          <SectionHead kicker="Built to be trusted" title="AI you can check" center />
          <View style={[s.trustGrid]}>
            {TRUST.map(([icon, title, text]) => (
              <View key={title} style={[s.trustCard, { width: wide ? "23.6%" : medium ? "48.9%" : "100%" }]}>
                <Ionicons name={`${icon}-outline`} size={24} color={c.primary} />
                <Text style={[s.cardTitle, { marginTop: 14 }]}>{title}</Text>
                <Text style={s.cardText}>{text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ---------- Pricing ---------- */}
        <View onLayout={anchor("pricing")} style={s.band}>
          <View style={[s.container, s.section, { alignItems: "center" }]}>
            <SectionHead kicker="Pricing" title="Start free. Upgrade when it pays for itself." center />
            <View style={s.toggle}>
              {[["month", "Monthly"], ["year", "Yearly"]].map(([k, label]) => (
                <Pressable key={k} onPress={() => setInterval_(k)} style={[s.toggleItem, interval === k && s.toggleActive]}>
                  <Text style={[s.toggleText, interval === k && { color: c.text }]}>{label}</Text>
                  {k === "year" && <Text style={s.save}>Save 17%</Text>}
                </Pressable>
              ))}
            </View>
            <View style={[s.plans, medium && { flexDirection: "row" }]}>
              {PLANS.map((p) => (
                <View key={p.key} style={[s.plan, medium && { flex: 1 }, p.featured && s.planFeatured]}>
                  {p.featured && <View style={s.planBadge}><Text style={s.planBadgeText}>Most popular</Text></View>}
                  <Text style={s.planName}>{p.name}</Text>
                  <View style={s.priceRow}>
                    <Text style={s.price}>{p.price[interval]}</Text>
                    <Text style={s.priceNote}>{typeof p.note === "string" ? p.note : p.note[interval]}</Text>
                  </View>
                  {p.perks.map((perk) => (
                    <View key={perk} style={s.perk}>
                      <Ionicons name="checkmark-circle" size={18} color={p.featured ? c.primary : c.gain} />
                      <Text style={s.perkText}>{perk}</Text>
                    </View>
                  ))}
                  <Button title={p.cta} variant={p.featured ? "primary" : "secondary"} size="lg" onPress={() => onStart("signup")} style={{ marginTop: 22 }} />
                </View>
              ))}
            </View>
            <Text style={s.pricingNote}>Prices in USD. Pro includes a free trial; you can cancel anytime from your account.</Text>
          </View>
        </View>

        {/* ---------- FAQ ---------- */}
        <View onLayout={anchor("faq")} style={[s.container, s.section, { maxWidth: 840 }]}>
          <SectionHead kicker="FAQ" title="Questions, answered" center />
          <View style={{ marginTop: 24 }}>
            {FAQ.map(([q, a], i) => (
              <Pressable key={q} onPress={() => setOpenFaq(openFaq === i ? -1 : i)} style={[s.faq, openFaq === i && s.faqOpen]}>
                <View style={s.faqHead}>
                  <Text style={s.faqQ}>{q}</Text>
                  <View style={[s.faqIcon, openFaq === i && { backgroundColor: c.primary }]}>
                    <Ionicons name={openFaq === i ? "remove" : "add"} size={16} color={openFaq === i ? "#FFFFFF" : c.textSecondary} />
                  </View>
                </View>
                {openFaq === i && <Text style={s.faqA}>{a}</Text>}
              </Pressable>
            ))}
          </View>
        </View>

        {/* ---------- Final CTA ---------- */}
        <View style={[s.container, { paddingBottom: 72 }]}>
          <LinearGradient colors={["#4F46E5", "#7C3AED", "#5B21B6"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.cta}>
            <View style={s.ctaGlyph} pointerEvents="none">
              <LogoGlyph size={medium ? 260 : 180} color="rgba(255,255,255,0.08)" accent="rgba(34,211,238,0.25)" />
            </View>
            <LogoMark size={52} />
            <Text style={[s.ctaTitle, !medium && { fontSize: 28, lineHeight: 34 }]}>Build a better process, starting tomorrow morning.</Text>
            <Text style={s.ctaText}>Set up your watchlist in two minutes. Your first brief arrives before the next open.</Text>
            <Pressable onPress={() => onStart("signup")} style={({ hovered }) => [s.ctaButton, hovered && { transform: [{ translateY: -1 }] }]}>
              <Text style={s.ctaButtonText}>Start free</Text>
              <Ionicons name="arrow-forward" size={18} color="#312E81" />
            </Pressable>
          </LinearGradient>
        </View>

        {/* ---------- Footer ---------- */}
        <View style={s.footer}>
          <View style={[s.container, s.footerInner, medium && { flexDirection: "row" }]}>
            <View style={[{ gap: 12 }, medium && { flex: 1.4 }]}>
              <Logo size={28} />
              <Text style={s.footerText}>An AI research team, a trading coach and a practice account for self-directed investors.</Text>
            </View>
            <FooterCol title="Product" links={[["Features", () => scrollTo("product")], ["Trading", () => scrollTo("trading")], ["Pricing", () => scrollTo("pricing")], ["FAQ", () => scrollTo("faq")]]} />
            <FooterCol title="Legal" links={[["Terms of Service", () => onOpenLegal?.("terms")], ["Privacy Policy", () => onOpenLegal?.("privacy")], ["Risk Disclaimer", () => onOpenLegal?.("disclaimer")]]} />
            <FooterCol title="Account" links={[["Sign in", () => onStart("signin")], ["Create account", () => onStart("signup")]]} />
          </View>
          <View style={[s.container, s.footerBottom]}>
            <Text style={s.footerLegal}>
              FinSight provides educational research generated by AI from market data and public SEC filings. It is not investment advice or a recommendation to buy, sell or hold any security. Trading involves risk, including loss of principal; options involve substantial risk. Data may be delayed or contain errors.
            </Text>
            <Text style={s.footerLegal}>© {new Date().getFullYear()} FinSight</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ---------- Building blocks ----------

function SectionHead({ kicker, title, lead, center }) {
  const s = useStyles();
  const narrow = useWindowDimensions().width < 680;
  return (
    <View style={[center && { alignItems: "center" }]}>
      <Text style={[s.kicker, center && { textAlign: "center" }]}>{kicker}</Text>
      <Text style={[s.h2, center && { textAlign: "center" }, narrow && { fontSize: 30, lineHeight: 36, letterSpacing: -1 }]}>{title}</Text>
      {lead ? <Text style={[s.sectionLead, center && { textAlign: "center" }, narrow && { fontSize: 16, lineHeight: 25 }]}>{lead}</Text> : null}
    </View>
  );
}

function Checks({ items }) {
  const { c } = useTheme();
  const s = useStyles();
  return items.map((t) => (
    <View key={t} style={s.check}>
      <Ionicons name="checkmark-circle" size={18} color={c.gain} />
      <Text style={s.checkText}>{t}</Text>
    </View>
  ));
}

function ShowcaseHead({ title, sub, pill }) {
  const s = useStyles();
  return (
    <View style={s.showcaseHead}>
      <View style={{ flex: 1 }}>
        <Text style={s.showcaseTitle}>{title}</Text>
        <Text style={s.showcaseSub}>{sub}</Text>
      </View>
      {pill}
    </View>
  );
}

function BentoTile({ style, icon, hue, title, text, children }) {
  const { c } = useTheme();
  const s = useStyles();
  const color = c.hue(hue);
  return (
    <View style={[s.bentoTile, style]}>
      <View style={s.bentoVisual}>{children}</View>
      <View style={s.bentoBody}>
        <View style={[s.bentoIcon, { backgroundColor: c.soft(color) }]}>
          <NavIcon name={icon} size={20} color={color} active />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>{title}</Text>
          <Text style={s.cardText}>{text}</Text>
        </View>
      </View>
    </View>
  );
}

function FooterCol({ title, links }) {
  const s = useStyles();
  return (
    <View style={{ flex: 1, gap: 10 }}>
      <Text style={s.footerHead}>{title}</Text>
      {links.map(([label, onPress]) => (
        <Text key={label} style={s.footerLink} onPress={onPress}>{label}</Text>
      ))}
    </View>
  );
}

// ---------- Illustrative product mocks (built from real app styling) ----------

function HeroDevice({ compact }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={{ width: compact ? 300 : 340 }}>
      <View style={s.device}>
        <View style={s.deviceNotch} />
        <View style={s.screen}>
          <View style={s.screenTop}>
            <Text style={s.screenEyebrow}>MONDAY · EXAMPLE</Text>
            <Text style={s.screenTitle}>Good morning</Text>
          </View>
          <View style={s.mCard}>
            <View style={s.mRow}>
              <View style={[s.mIcon, { backgroundColor: c.soft(c.hue("violet")) }]}><NavIcon name="copilot" size={15} color={c.hue("violet")} active /></View>
              <Text style={s.mCardTitle}>Morning brief</Text>
            </View>
            <Text style={s.mHeadline}>XMPL reports earnings after the close; options imply a ±6.1% move.</Text>
            {[["XMPL", "Earnings today · implied ±6.1%", c.loss], ["DEMO", "New 8-K filed · CFO transition", c.warn], ["SMPL", "Up 3.2% on volume 2× average", c.muted]].map(([t, d, col]) => (
              <View key={t} style={s.mItem}>
                <View style={[s.mBar, { backgroundColor: col }]} />
                <Text style={s.mTicker}>{t}</Text>
                <Text style={s.mText} numberOfLines={1}>{d}</Text>
              </View>
            ))}
          </View>
          <View style={s.mCard}>
            <View style={[s.mRow, { justifyContent: "space-between" }]}>
              <Text style={s.mCardTitle}>Practice account</Text>
              <Text style={[s.mText, s.mGain]}>+4.82%</Text>
            </View>
            <Text style={s.mEquity}>$104,820.15</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <View style={[s.mBtn, { backgroundColor: c.gain }]}><Text style={s.mBtnText}>Buy</Text></View>
              <View style={[s.mBtn, { backgroundColor: c.loss }]}><Text style={s.mBtnText}>Sell</Text></View>
            </View>
          </View>
          <View style={s.mTabs}>
            {["today", "copilot", "trade", "portfolio", "more"].map((k, i) => (
              <View key={k} style={[s.mTab, i === 0 && { backgroundColor: c.primarySoft }]}>
                <NavIcon name={k} size={17} color={i === 0 ? c.primary : c.muted} active={i === 0} />
              </View>
            ))}
          </View>
        </View>
      </View>
      {!compact && (
        <>
          <View style={[s.float, { left: -96, top: -6 }]}>
            <View style={[s.floatIcon, { backgroundColor: c.gainSoft }]}><Ionicons name="checkmark" size={14} color={c.gain} /></View>
            <View>
              <Text style={s.floatTitle}>Paper order filled</Text>
              <Text style={s.floatText}>Bought 10 XMPL at $182.40</Text>
            </View>
          </View>
          <View style={[s.float, { right: -84, bottom: 64 }]}>
            <View style={[s.floatIcon, { backgroundColor: c.soft(c.hue("violet")) }]}><Ionicons name="shield-checkmark" size={14} color={c.hue("violet")} /></View>
            <View>
              <Text style={s.floatTitle}>Thesis: intact</Text>
              <Text style={s.floatText}>Revenue +31% fits your thesis</Text>
            </View>
          </View>
        </>
      )}
      <Text style={s.mockNote}>Illustrative example</Text>
    </View>
  );
}

function CopilotMini() {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={{ gap: 10 }}>
      <View style={s.bubbleUser}><Text style={s.bubbleUserText}>Is XMPL extended going into earnings?</Text></View>
      <View style={s.bubbleAi}>
        <View style={s.toolRow}>
          {["Price & technicals", "Earnings preview", "Red-flag scan"].map((t) => (
            <View key={t} style={s.toolChip}>
              <Ionicons name="checkmark-circle" size={11} color={c.gain} />
              <Text style={s.toolChipText}>{t}</Text>
            </View>
          ))}
        </View>
        <Text style={s.bubbleAiText}>
          It's up <Text style={s.strong}>18%</Text> in a month with RSI at <Text style={s.strong}>71</Text>. Options price a <Text style={s.strong}>±6.1%</Text> move vs a <Text style={s.strong}>4.3%</Text> average after past reports.
        </Text>
      </View>
    </View>
  );
}

function BriefMini() {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={{ gap: 8 }}>
      {[["XMPL", "Earnings today", c.loss], ["DEMO", "Insider bought $2.1M", c.warn], ["SMPL", "Broke above resistance", c.hue("sky")]].map(([t, d, col]) => (
        <View key={t} style={s.miniRow}>
          <View style={[s.mBar, { backgroundColor: col, height: 26 }]} />
          <Text style={s.mTicker}>{t}</Text>
          <Text style={s.mText} numberOfLines={1}>{d}</Text>
        </View>
      ))}
    </View>
  );
}

function TradeMini() {
  const { c } = useTheme();
  const s = useStyles();
  const pts = [8, 12, 10, 15, 14, 19, 17, 22, 21, 26];
  return (
    <View>
      <Text style={s.miniBig}>$104,820</Text>
      <View style={s.spark}>
        {pts.map((p, i) => <View key={i} style={[s.sparkBar, { height: p * 2, backgroundColor: i === pts.length - 1 ? c.gain : c.soft(c.gain) }]} />)}
      </View>
    </View>
  );
}

function CoachMini() {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[["58%", "Win rate"], ["1.9", "Profit factor"]].map(([v, l]) => (
          <View key={l} style={s.miniStat}>
            <Text style={s.miniStatValue}>{v}</Text>
            <Text style={s.miniStatLabel}>{l}</Text>
          </View>
        ))}
      </View>
      <View style={[s.miniLeak, { backgroundColor: c.lossSoft }]}>
        <Text style={s.miniLeakText}>Leak: trades within a day of a loss lose 71% of the time</Text>
      </View>
    </View>
  );
}

function EarningsMini() {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={{ gap: 7 }}>
      {[["Implied", 6.1, c.primary], ["Q2", 4.8, c.gain], ["Q1", -3.2, c.loss], ["Q4", 5.6, c.gain]].map(([l, v, col]) => (
        <View key={l} style={s.miniRow}>
          <Text style={[s.mText, { flex: 0, width: 54 }]}>{l}</Text>
          <View style={s.miniTrack}><View style={[s.miniFill, { width: `${(Math.abs(v) / 7) * 100}%`, backgroundColor: col }]} /></View>
          <Text style={[s.mTicker, { width: 48, textAlign: "right", color: col }]}>{l === "Implied" ? "±" : v > 0 ? "+" : ""}{v}%</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  page: { flex: 1, backgroundColor: c.bg },
  fillAbs: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  container: { width: "100%", maxWidth: 1180, alignSelf: "center", paddingHorizontal: 22 },
  // Nav
  nav: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.dark ? "rgba(6,8,15,0.88)" : "rgba(255,255,255,0.88)", zIndex: 10 },
  navInner: { width: "100%", maxWidth: 1180, alignSelf: "center", paddingHorizontal: 22, height: 66, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navLinks: { flexDirection: "row", gap: 4 },
  navLink: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  navLinkText: { color: c.textSecondary, fontWeight: "600", fontSize: 14 },
  navCtas: { flexDirection: "row", gap: 8, alignItems: "center" },
  // Hero
  heroWrap: { overflow: "hidden", borderBottomWidth: 1, borderBottomColor: c.border },
  // Dotted grid texture (web); ignored on native
  gridBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundImage: `radial-gradient(${alpha(c.dark ? "#FFFFFF" : "#1E1B4B", 0.09)} 1px, transparent 1px)`, backgroundSize: "22px 22px" },
  hero: { paddingTop: 76, paddingBottom: 84 },
  announce: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start", backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingLeft: 5, paddingRight: 14, paddingVertical: 5 },
  announceTag: { backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  announceTagText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  announceText: { color: c.textSecondary, fontSize: 13, fontWeight: "600" },
  h1: { color: c.text, fontSize: 56, lineHeight: 61, fontWeight: "800", letterSpacing: -2.2, marginTop: 26 },
  h1Accent: { color: c.primary, fontWeight: "800" },
  lead: { color: c.textSecondary, fontSize: 18.5, lineHeight: 29, marginTop: 22, maxWidth: 580 },
  ctaRow: { flexDirection: "row", gap: 12, marginTop: 32, flexWrap: "wrap", alignItems: "center" },
  primaryCta: { borderRadius: 14, shadowColor: "#5B5BF7", shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  primaryCtaInner: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, paddingHorizontal: 26, paddingVertical: 17 },
  primaryCtaText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  trustRow: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: 26 },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  trustText: { color: c.textSecondary, fontSize: 13, fontWeight: "500" },
  // Device mock
  device: { borderRadius: 46, padding: 10, backgroundColor: c.dark ? "#1B2030" : "#0F1220", shadowColor: "#1E1B4B", shadowOpacity: c.dark ? 0.6 : 0.28, shadowRadius: 50, shadowOffset: { width: 0, height: 30 }, elevation: 18 },
  deviceNotch: { position: "absolute", top: 18, alignSelf: "center", width: 96, height: 26, borderRadius: 14, backgroundColor: "#000", zIndex: 2 },
  screen: { borderRadius: 37, overflow: "hidden", backgroundColor: c.bg, paddingTop: 52, paddingHorizontal: 12 },
  screenTop: { paddingHorizontal: 4, marginBottom: 10 },
  screenEyebrow: { color: c.primary, fontSize: 9, fontWeight: "700", letterSpacing: 0.6 },
  screenTitle: { color: c.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.6, marginTop: 2 },
  mCard: { backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.border, padding: 12, marginBottom: 10 },
  mRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  mIcon: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  mCardTitle: { color: c.text, fontSize: 13, fontWeight: "700" },
  mHeadline: { color: c.text, fontSize: 12, fontWeight: "600", lineHeight: 17, marginTop: 8 },
  mItem: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  mBar: { width: 3, height: 18, borderRadius: 2 },
  mTicker: { color: c.text, fontSize: 11, fontWeight: "800" },
  mText: { flex: 1, color: c.textSecondary, fontSize: 11 },
  mGain: { flex: 0, color: c.gain, fontWeight: "700" },
  mEquity: { color: c.text, fontSize: 22, fontWeight: "800", letterSpacing: -0.6, marginTop: 4, fontVariant: ["tabular-nums"] },
  mBtn: { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  mBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  mTabs: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 10, marginHorizontal: -12, marginTop: 4, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface },
  mTab: { width: 40, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  float: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.elevated, borderRadius: 16, borderWidth: 1, borderColor: c.border, paddingVertical: 10, paddingHorizontal: 12, shadowColor: c.shadow, shadowOpacity: c.dark ? 0.5 : 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
  floatIcon: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  floatTitle: { color: c.text, fontSize: 12.5, fontWeight: "700" },
  floatText: { color: c.textSecondary, fontSize: 11.5, marginTop: 1 },
  mockNote: { color: c.muted, fontSize: 11, textAlign: "center", marginTop: 14 },
  // Built on
  builtOn: { paddingVertical: 28, alignItems: "center" },
  builtOnLabel: { color: c.muted, fontSize: 12, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" },
  builtOnRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 28, marginTop: 14 },
  builtOnItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  builtOnText: { color: c.textSecondary, fontSize: 15, fontWeight: "600" },
  // Sections
  section: { paddingVertical: 80 },
  band: { backgroundColor: c.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border },
  kicker: { color: c.primary, fontWeight: "700", fontSize: 13, letterSpacing: 0.8, textTransform: "uppercase" },
  h2: { color: c.text, fontSize: 40, lineHeight: 46, fontWeight: "800", letterSpacing: -1.4, marginTop: 12, maxWidth: 760 },
  sectionLead: { color: c.textSecondary, fontSize: 17.5, lineHeight: 27, marginTop: 16, maxWidth: 640 },
  // Bento
  bento: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 44, justifyContent: "space-between" },
  bentoTile: { backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.border, overflow: "hidden", shadowColor: c.shadow, shadowOpacity: c.dark ? 0 : 0.05, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
  bentoVisual: { padding: 20, minHeight: 168, justifyContent: "center", backgroundColor: c.surfaceAlt, borderBottomWidth: 1, borderBottomColor: c.border },
  bentoBody: { flexDirection: "row", gap: 14, padding: 20 },
  bentoIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: c.text, fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  cardText: { color: c.textSecondary, fontSize: 14.5, lineHeight: 22, marginTop: 6 },
  moreFeatures: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 28, justifyContent: "center" },
  moreChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingHorizontal: 14, paddingVertical: 8 },
  moreChipText: { color: c.textSecondary, fontSize: 13, fontWeight: "600" },
  // Mini visuals
  bubbleUser: { alignSelf: "flex-end", backgroundColor: c.primary, borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 9, maxWidth: "80%" },
  bubbleUserText: { color: "#FFFFFF", fontSize: 13.5 },
  bubbleAi: { backgroundColor: c.surface, borderRadius: 16, borderTopLeftRadius: 4, borderWidth: 1, borderColor: c.border, padding: 12, maxWidth: "92%" },
  toolRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  toolChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.surfaceAlt, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  toolChipText: { color: c.textSecondary, fontSize: 11, fontWeight: "600" },
  bubbleAiText: { color: c.text, fontSize: 13.5, lineHeight: 20 },
  strong: { fontWeight: "700" },
  miniRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: c.border },
  miniBig: { color: c.text, fontSize: 28, fontWeight: "800", letterSpacing: -1, fontVariant: ["tabular-nums"] },
  spark: { flexDirection: "row", alignItems: "flex-end", gap: 5, height: 56, marginTop: 12 },
  sparkBar: { flex: 1, borderRadius: 4 },
  miniStat: { flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: c.border },
  miniStatValue: { color: c.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  miniStatLabel: { color: c.muted, fontSize: 11, marginTop: 1 },
  miniLeak: { borderRadius: 12, padding: 10 },
  miniLeakText: { color: c.text, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  miniTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: "hidden" },
  miniFill: { height: 8, borderRadius: 4 },
  // Showcases
  showcase: { backgroundColor: c.bg, borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 18, shadowColor: c.shadow, shadowOpacity: c.dark ? 0.5 : 0.1, shadowRadius: 36, shadowOffset: { width: 0, height: 18 }, elevation: 6 },
  showcaseHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  showcaseTitle: { color: c.text, fontWeight: "700", fontSize: 15.5 },
  showcaseSub: { color: c.muted, fontSize: 12, marginTop: 1 },
  aiNote: { flexDirection: "row", gap: 10, backgroundColor: c.primarySoft, borderRadius: 14, padding: 12, marginTop: 12, alignItems: "flex-start" },
  aiNoteText: { flex: 1, color: c.textSecondary, fontSize: 13, lineHeight: 19 },
  aiNoteStrong: { color: c.text, fontWeight: "700" },
  check: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  checkText: { color: c.text, fontSize: 15.5, flex: 1 },
  // Trading
  tradeGrid: { gap: 16, marginTop: 44 },
  tradeCard: { backgroundColor: c.surface, borderRadius: 22, borderWidth: 1, borderColor: c.border, padding: 22 },
  tradeIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  proRow: { gap: 16, marginTop: 16 },
  // Steps
  steps: { gap: 16, marginTop: 44 },
  step: { backgroundColor: c.bg, borderRadius: 22, borderWidth: 1, borderColor: c.border, padding: 24 },
  stepTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  stepIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepNum: { color: c.borderStrong, fontSize: 30, fontWeight: "800", letterSpacing: -1 },
  // Trust
  trustGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 44, justifyContent: "space-between" },
  trustCard: { backgroundColor: c.surface, borderRadius: 22, borderWidth: 1, borderColor: c.border, padding: 22 },
  // Pricing
  toggle: { flexDirection: "row", backgroundColor: c.surfaceAlt, borderRadius: 999, padding: 4, marginTop: 28 },
  toggleItem: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999 },
  toggleActive: { backgroundColor: c.surface, shadowColor: c.shadow, shadowOpacity: c.dark ? 0.4 : 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  toggleText: { color: c.muted, fontWeight: "600", fontSize: 14 },
  save: { color: c.gain, fontSize: 11.5, fontWeight: "700" },
  plans: { gap: 18, marginTop: 30, width: "100%", maxWidth: 820 },
  plan: { backgroundColor: c.bg, borderRadius: 26, borderWidth: 1, borderColor: c.border, padding: 28 },
  planFeatured: { borderWidth: 2, borderColor: c.primary, backgroundColor: c.surface, shadowColor: c.primary, shadowOpacity: 0.18, shadowRadius: 30, shadowOffset: { width: 0, height: 14 } },
  planBadge: { position: "absolute", top: -13, right: 24, backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  planBadgeText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  planName: { color: c.text, fontSize: 20, fontWeight: "700" },
  priceRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 10, marginBottom: 14 },
  price: { color: c.text, fontSize: 48, fontWeight: "800", letterSpacing: -2 },
  priceNote: { color: c.muted, fontSize: 14, marginBottom: 9 },
  perk: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 12 },
  perkText: { flex: 1, color: c.text, fontSize: 15, lineHeight: 21 },
  pricingNote: { color: c.muted, fontSize: 13, marginTop: 22, textAlign: "center" },
  // FAQ
  faq: { borderRadius: 18, paddingHorizontal: 20, paddingVertical: 18, marginBottom: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  faqOpen: { borderColor: c.primarySoft },
  faqHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  faqQ: { color: c.text, fontSize: 16.5, fontWeight: "600", flex: 1 },
  faqIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" },
  faqA: { color: c.textSecondary, fontSize: 15, lineHeight: 24, marginTop: 12 },
  // CTA
  cta: { borderRadius: 32, paddingVertical: 64, paddingHorizontal: 28, alignItems: "center", overflow: "hidden" },
  ctaGlyph: { position: "absolute", right: -40, bottom: -50 },
  ctaTitle: { color: "#FFFFFF", fontSize: 40, lineHeight: 46, fontWeight: "800", letterSpacing: -1.4, textAlign: "center", marginTop: 22, maxWidth: 720 },
  ctaText: { color: "rgba(255,255,255,0.85)", fontSize: 17.5, lineHeight: 26, marginTop: 14, textAlign: "center", maxWidth: 560 },
  ctaButton: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFFFFF", borderRadius: 14, paddingHorizontal: 26, paddingVertical: 17, marginTop: 30 },
  ctaButtonText: { color: "#312E81", fontWeight: "700", fontSize: 16 },
  // Footer
  footer: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 48, paddingBottom: 32, backgroundColor: c.surface },
  footerInner: { gap: 32 },
  footerText: { color: c.textSecondary, fontSize: 14, lineHeight: 21, maxWidth: 340 },
  footerHead: { color: c.text, fontSize: 13, fontWeight: "700", letterSpacing: 0.3 },
  footerLink: { color: c.textSecondary, fontSize: 14 },
  footerBottom: { marginTop: 40, paddingTop: 24, borderTopWidth: 1, borderTopColor: c.border, gap: 10 },
  footerLegal: { color: c.muted, fontSize: 12, lineHeight: 18 },
}));
