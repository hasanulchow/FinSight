import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { formatMoney, makeStyles, scoreLabel, useTheme, font } from "../theme";
import { BackButton, Bullets, Button, Disclaimer, Pill, ScoreBar, SectionCard, Stat, TickerAvatar } from "../components/ui";
import TechnicalsCard from "../components/TechnicalsCard";
import EventsCard from "../components/EventsCard";
import AskPanel from "../components/AskPanel";
import AlertSheet from "../components/AlertSheet";
import { shareLink } from "../lib/share";

// Pipeline steps, matched against the progress text the API writes (server/src/agents/orchestrator.js)
const STEPS = [
  { match: "Looking up", label: "Finding the company", icon: "search-outline" },
  { match: "Fetching", label: "Pulling quote, prices and SEC financials", icon: "cloud-download-outline" },
  { match: "Reading", label: "Reading the latest 10-K", icon: "book-outline" },
  { match: "Analysts", label: "Analysts at work, including technicals", icon: "people-outline" },
  { match: "Writing", label: "Writing your briefing", icon: "create-outline" },
  { match: "Compliance", label: "Compliance review", icon: "shield-checkmark-outline" },
  { match: "Evaluating", label: "Scoring quality", icon: "ribbon-outline" },
];

export default function BriefingScreen({ id, onBack }) {
  const theme = useTheme();
  const { c, sections } = theme;
  const s = useStyles();
  const [briefing, setBriefing] = useState(null);
  const [error, setError] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertCreated, setAlertCreated] = useState(false);
  const [shared, setShared] = useState(null);

  async function share() {
    try {
      const { url } = await api.shareBriefing(id);
      const how = await shareLink({ title: `${briefing.ticker} briefing`, message: `AI briefing on ${briefing.ticker} from FinSight:`, url });
      setShared(how === "copied" ? "Link copied" : null);
    } catch (e) {
      setShared(e.message);
    }
  }

  // Poll while the agents are running
  useEffect(() => {
    let timer;
    let cancelled = false;
    async function poll() {
      try {
        const data = await api.getBriefing(id);
        if (cancelled) return;
        setBriefing(data);
        if (data.status === "running") timer = setTimeout(poll, 2500);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (error) return <Message onBack={onBack} icon="cloud-offline-outline" color={c.loss} title="Couldn't load this briefing" text={error} />;
  if (!briefing || briefing.status === "running") return <Progress onBack={onBack} briefing={briefing} />;
  if (briefing.status === "failed") return <Message onBack={onBack} icon="alert-circle-outline" color={c.warn} title={`We couldn't brief ${briefing.ticker}`} text={briefing.error} />;

  const b = briefing.content;
  const evaluation = briefing.evaluations?.[0];
  const q = b.snapshot;
  const up = (q.change ?? 0) >= 0;
  const move = up ? c.gain : c.loss;

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <BackButton onPress={onBack} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {shared ? <Text style={s.muted}>{shared}</Text> : null}
          <Button title="Share" icon="share-social-outline" size="sm" variant="ghost" onPress={share} />
        </View>
      </View>

      {/* Hero */}
      <View style={s.hero}>
        <View style={s.heroTop}>
          <TickerAvatar ticker={b.company.ticker} size={54} />
          <View style={{ flex: 1 }}>
            <Text style={s.company} numberOfLines={2}>{b.company.name}</Text>
            <Text style={s.muted}>{b.company.ticker}{b.company.exchange ? ` · ${b.company.exchange}` : ""}{b.company.industry ? ` · ${b.company.industry}` : ""}</Text>
          </View>
          {evaluation && (
            <View style={[s.scoreBadge, { backgroundColor: c.soft(theme.scoreColor(evaluation.overall)) }]}>
              <Ionicons name="star" size={12} color={theme.scoreColor(evaluation.overall)} />
              <Text style={[s.scoreBadgeText, { color: theme.scoreColor(evaluation.overall) }]}>{Number(evaluation.overall).toFixed(1)}</Text>
            </View>
          )}
        </View>
        <View style={s.priceRow}>
          <Text style={s.price}>${q.price?.toFixed(2)}</Text>
          <View style={[s.change, { backgroundColor: c.soft(move) }]}>
            <Ionicons name={up ? "caret-up" : "caret-down"} size={13} color={move} />
            <Text style={[s.changeText, { color: move }]}>{Math.abs(q.change ?? 0).toFixed(2)} ({Math.abs(q.changePercent ?? 0).toFixed(2)}%)</Text>
          </View>
        </View>
        <Text style={s.small}>Quote as of {new Date(q.asOf).toLocaleString()}</Text>
        <View style={s.stats}>
          <Stat icon="business-outline" label="Market cap" value={q.marketCapMillions ? formatMoney(q.marketCapMillions * 1e6) : "n/a"} />
          <Stat icon="calculator-outline" label="P/E (TTM)" value={q.peRatio ? q.peRatio.toFixed(1) : "n/a"} />
          <Stat icon="pulse-outline" label="Beta" value={q.beta ? q.beta.toFixed(2) : "n/a"} />
        </View>
        {q.week52Low && q.week52High && <RangeBar low={q.week52Low} high={q.week52High} price={q.price} />}
        <Button
          title={alertCreated ? "Alert created · add another" : "Set an alert"}
          icon={alertCreated ? "notifications" : "notifications-outline"}
          variant="secondary"
          onPress={() => setAlertOpen(true)}
          style={{ marginTop: 16 }}
        />
      </View>

      <SectionCard title="Quick read" subtitle="Everything you need in 30 seconds" section={sections.summary}>
        <Text style={s.lead}>{b.executive_summary}</Text>
      </SectionCard>

      {b.changes_since_last?.length > 0 && (
        <SectionCard title="Since your last look" section={sections.changes}>
          <Bullets items={b.changes_since_last} color={sections.changes.color} />
        </SectionCard>
      )}

      {b.technicals && <TechnicalsCard snapshot={b.technicals.snapshot} chart={b.technicals.chart} analysis={b.technicals.analysis} />}

      <SectionCard title="Key takeaways" section={sections.takeaways}>
        <Bullets items={b.key_takeaways} color={sections.takeaways.color} />
      </SectionCard>

      <SectionCard title="Market today" section={sections.market}>
        <Text style={[s.body, { marginBottom: 10 }]}>{b.market.commentary}</Text>
        <Bullets items={b.market.key_stats} color={sections.market.color} />
      </SectionCard>

      <SectionCard title="Financials" subtitle="From SEC XBRL filings" section={sections.financials}>
        <FinancialTable financials={b.financials} />
        <Text style={[s.body, { marginTop: 14 }]}>{b.fundamentals.summary}</Text>
        {b.fundamentals.trends.map((t) => <Trend key={t.metric} trend={t} />)}
        <View style={s.twoCol}>
          <View style={[s.mini, { backgroundColor: c.gainSoft }]}>
            <View style={s.miniHead}><Ionicons name="thumbs-up-outline" size={14} color={c.gain} /><Text style={[s.miniTitle, { color: c.gain }]}>Strengths</Text></View>
            {b.fundamentals.strengths.map((x, i) => <Text key={i} style={s.miniText}>{x}</Text>)}
          </View>
          <View style={[s.mini, { backgroundColor: c.warnSoft }]}>
            <View style={s.miniHead}><Ionicons name="eye-outline" size={14} color={c.warn} /><Text style={[s.miniTitle, { color: c.warn }]}>Watch</Text></View>
            {b.fundamentals.concerns.map((x, i) => <Text key={i} style={s.miniText}>{x}</Text>)}
          </View>
        </View>
      </SectionCard>

      <SectionCard title="The business" section={sections.business}>
        <Text style={s.body}>{b.business.business_overview}</Text>
        {b.business.segments.length > 0 && (
          <View style={s.wrap}>{b.business.segments.map((x, i) => <Pill key={i} text={x} color={sections.business.color} />)}</View>
        )}
        <Text style={s.subhead}>Management outlook</Text>
        <Text style={s.body}>{b.business.management_outlook}</Text>
      </SectionCard>

      <SectionCard title="Top risks" subtitle="From 10-K Item 1A" section={sections.risks}>
        <Text style={s.body}>{b.risks.overview}</Text>
        {b.risks.top_risks.map((r, i) => (
          <View key={r.title} style={s.risk}>
            <View style={s.riskHead}>
              <View style={[s.riskNum, { backgroundColor: sections.risks.soft }]}><Text style={{ color: sections.risks.color, fontWeight: "800", fontFamily: font("800"), fontSize: 12 }}>{i + 1}</Text></View>
              <Text style={s.riskTitle}>{r.title}</Text>
              <Pill text={r.category} color={theme.riskColor(r.category)} />
            </View>
            <Text style={s.body}>{r.summary}</Text>
            <View style={s.quote}>
              <View style={[s.quoteBar, { backgroundColor: sections.risks.color }]} />
              <Text style={s.quoteText}>“{r.evidence}”</Text>
            </View>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Recent filings" section={sections.filings}>
        {b.business.recent_events.map((e, i) => (
          <View key={i} style={s.timelineRow}>
            <View style={s.timelineRail}>
              <View style={[s.timelineDot, { backgroundColor: sections.filings.color }]} />
              {i < b.business.recent_events.length - 1 && <View style={s.timelineLine} />}
            </View>
            <View style={{ flex: 1, paddingBottom: 14 }}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Pill text={e.form} color={sections.filings.color} />
                <Text style={s.small}>{e.date}</Text>
              </View>
              <Text style={[s.body, { marginTop: 6 }]}>{e.summary}</Text>
            </View>
          </View>
        ))}
        {b.sources.latest10K && (
          <Pressable style={s.link} onPress={() => Linking.openURL(b.sources.latest10K)}>
            <Ionicons name="open-outline" size={16} color={sections.filings.color} />
            <Text style={[s.linkText, { color: sections.filings.color }]}>Open the latest 10-K on SEC.gov</Text>
          </Pressable>
        )}
      </SectionCard>

      <EventsCard ticker={b.company.ticker} />

      <SectionCard title="Talking points" section={sections.talking}>
        <Bullets items={b.talking_points} color={sections.talking.color} />
      </SectionCard>

      <SectionCard title="Questions to consider" section={sections.questions}>
        <Bullets items={b.questions_to_consider} color={sections.questions.color} />
      </SectionCard>

      <AskPanel briefingId={briefing.id} />

      {evaluation && <QualityCard evaluation={evaluation} compliance={b.compliance} logs={briefing.agent_logs} />}

      <Feedback id={briefing.id} />

      <Disclaimer>{b.disclaimer}</Disclaimer>

      <AlertSheet ticker={b.company.ticker} price={q.price} visible={alertOpen} onClose={() => setAlertOpen(false)} onCreated={() => setAlertCreated(true)} />
    </ScrollView>
  );
}

function Progress({ onBack, briefing }) {
  const { c } = useTheme();
  const s = useStyles();
  const progress = briefing?.progress ?? "";
  const current = Math.max(0, STEPS.findIndex((st) => progress.startsWith(st.match)));
  const pct = Math.round(((current + 0.5) / STEPS.length) * 100);
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <BackButton onPress={onBack} />
      <View style={[s.hero, { alignItems: "center", paddingVertical: 28 }]}>
        <View style={s.progressBadge}><Ionicons name="sparkles" size={26} color={c.primary} /></View>
        <Text style={s.progressTitle}>Researching {briefing?.ticker ?? ""}</Text>
        <Text style={[s.muted, { textAlign: "center" }]}>Usually about a minute. You can leave and come back.</Text>
        <View style={s.progressTrack}><View style={[s.progressFill, { width: `${pct}%` }]} /></View>
        <Text style={[s.small, { color: c.primary, fontWeight: "700", fontFamily: font("700") }]}>{pct}%</Text>
      </View>
      <View style={[s.hero, { marginTop: 12 }]}>
        {STEPS.map((st, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <View key={st.match} style={s.stepRow}>
              <View style={[s.stepIcon, { backgroundColor: done ? c.gainSoft : active ? c.primarySoft : c.surfaceAlt }]}>
                {done ? <Ionicons name="checkmark" size={17} color={c.gain} /> : active ? <ActivityIndicator size="small" color={c.primary} /> : <Ionicons name={st.icon} size={15} color={c.muted} />}
              </View>
              <Text style={[s.stepText, done && { color: c.textSecondary }, active && { color: c.text, fontWeight: "700", fontFamily: font("700") }]}>{st.label}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function Message({ onBack, icon, color, title, text }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <BackButton onPress={onBack} />
      <View style={[s.hero, { alignItems: "center", marginTop: 24, paddingVertical: 30 }]}>
        <View style={[s.progressBadge, { backgroundColor: c.soft(color) }]}><Ionicons name={icon} size={28} color={color} /></View>
        <Text style={s.progressTitle}>{title}</Text>
        <Text style={[s.muted, { textAlign: "center", marginTop: 6 }]}>{text}</Text>
        <Button title="Try another ticker" icon="search" onPress={onBack} style={{ marginTop: 20, alignSelf: "stretch" }} />
      </View>
    </ScrollView>
  );
}

function RangeBar({ low, high, price }) {
  const s = useStyles();
  const pos = Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
  return (
    <View style={{ marginTop: 16 }}>
      <View style={s.rangeTrack}>
        <View style={[s.rangeFill, { width: `${pos}%` }]} />
        <View style={[s.rangeMarker, { left: `${pos}%` }]} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
        <Text style={s.small}>52w low ${low.toFixed(2)}</Text>
        <Text style={s.small}>52w high ${high.toFixed(2)}</Text>
      </View>
    </View>
  );
}

function Trend({ trend }) {
  const { c } = useTheme();
  const s = useStyles();
  const T = { up: { icon: "arrow-up", color: c.gain }, down: { icon: "arrow-down", color: c.loss }, flat: { icon: "remove", color: c.muted }, mixed: { icon: "swap-vertical", color: c.warn } };
  const t = T[trend.direction] ?? T.flat;
  return (
    <View style={s.trendRow}>
      <View style={[s.trendIcon, { backgroundColor: c.soft(t.color) }]}><Ionicons name={t.icon} size={14} color={t.color} /></View>
      <Text style={[s.body, { flex: 1 }]}><Text style={{ fontWeight: "700", fontFamily: font("700") }}>{trend.metric}: </Text>{trend.detail}</Text>
    </View>
  );
}

function FinancialTable({ financials }) {
  const s = useStyles();
  const rows = [["Revenue", "revenue"], ["Operating income", "operatingIncome"], ["Net income", "netIncome"], ["Diluted EPS", "epsDiluted"], ["Cash", "cash"], ["Long-term debt", "longTermDebt"]].filter(([, k]) => financials[k]?.length);
  const years = [...new Set(rows.flatMap(([, k]) => financials[k].map((p) => p.year)))].sort().slice(-4);
  if (!rows.length) return <Text style={s.muted}>No SEC financial data available for this company.</Text>;
  return (
    <View style={s.table}>
      <View style={[s.tr, s.thRow]}>
        <Text style={[s.td, s.th, { flex: 1.6, textAlign: "left" }]}>USD</Text>
        {years.map((y) => <Text key={y} style={[s.td, s.th]}>{y}</Text>)}
      </View>
      {rows.map(([label, key], i) => (
        <View key={key} style={[s.tr, i % 2 === 1 && s.trAlt]}>
          <Text style={[s.td, { flex: 1.6, textAlign: "left", fontWeight: "600", fontFamily: font("600") }]}>{label}</Text>
          {years.map((y) => {
            const v = financials[key].find((p) => p.year === y)?.value;
            return <Text key={y} style={s.td}>{v == null ? "–" : key === "epsDiluted" ? `$${v.toFixed(2)}` : formatMoney(v)}</Text>;
          })}
        </View>
      ))}
    </View>
  );
}

function QualityCard({ evaluation, compliance, logs = [] }) {
  const theme = useTheme();
  const { c, sections } = theme;
  const s = useStyles();
  const [showTrace, setShowTrace] = useState(false);
  const checks = evaluation.checks ?? {};
  const totalTokens = logs.reduce((sum, l) => sum + (l.input_tokens ?? 0) + (l.output_tokens ?? 0), 0);
  const overall = Number(evaluation.overall);
  const col = theme.scoreColor(overall);
  return (
    <SectionCard title="How reliable is this?" subtitle="Scored by an independent AI reviewer" section={sections.quality}>
      <View style={[s.overall, { backgroundColor: c.soft(col) }]}>
        <Text style={[s.overallScore, { color: col }]}>{overall.toFixed(1)}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[s.overallLabel, { color: col }]}>{scoreLabel(overall)}</Text>
          <Text style={s.small}>Checked against the source data it was built from</Text>
        </View>
      </View>
      <ScoreBar label="Accuracy" value={evaluation.faithfulness} />
      <ScoreBar label="Completeness" value={evaluation.completeness} />
      <ScoreBar label="Compliance" value={evaluation.compliance} />
      <ScoreBar label="Clarity" value={evaluation.clarity} />
      <Text style={[s.body, { marginTop: 12 }]}>{evaluation.rationale}</Text>
      {evaluation.issues?.length > 0 && (
        <View style={[s.mini, { backgroundColor: c.warnSoft, marginTop: 12 }]}>
          <Text style={[s.miniTitle, { color: c.warn }]}>Double-check these claims</Text>
          {evaluation.issues.map((x, i) => <Text key={i} style={s.miniText}>• {x}</Text>)}
        </View>
      )}
      <View style={s.wrap}>
        <Pill text={`${checks.passed}/${checks.total} automated checks`} color={checks.passed === checks.total ? c.gain : c.warn} icon="checkmark-done" />
        {evaluation.grounding?.numbers?.rate != null && <Pill text={`${Math.round(evaluation.grounding.numbers.rate * 100)}% numbers grounded`} color={c.primary} />}
        <Pill text={`${compliance?.issues_found?.length ?? 0} compliance edits`} color={c.primary} />
      </View>
      <Pressable style={s.link} onPress={() => setShowTrace(!showTrace)}>
        <Ionicons name={showTrace ? "chevron-up" : "chevron-down"} size={16} color={c.primary} />
        <Text style={[s.linkText, { color: c.primary }]}>{showTrace ? "Hide" : "Show"} agent trace · {logs.length} calls · {totalTokens.toLocaleString()} tokens</Text>
      </Pressable>
      {showTrace && logs.map((l, i) => (
        <View key={i} style={s.traceRow}>
          <Ionicons name={l.status === "ok" ? "checkmark-circle" : "close-circle"} size={14} color={l.status === "ok" ? c.gain : c.loss} />
          <Text style={[s.small, { flex: 1, textTransform: "capitalize" }]}>{l.agent.replace(/_/g, " ")}</Text>
          <Text style={s.small}>{(l.latency_ms / 1000).toFixed(1)}s · {((l.input_tokens ?? 0) + (l.output_tokens ?? 0)).toLocaleString()} tok</Text>
        </View>
      ))}
    </SectionCard>
  );
}

function Feedback({ id }) {
  const { c } = useTheme();
  const s = useStyles();
  const [sent, setSent] = useState(null);
  const send = async (rating) => {
    try {
      await api.sendFeedback(id, rating);
      setSent(rating);
    } catch {
      setSent("error");
    }
  };
  const title = sent === "error" ? "Couldn't save your feedback. Try again." : sent ? "Thanks! Your feedback helps us improve." : "Was this briefing helpful?";
  return (
    <View style={s.feedback}>
      <Text style={s.feedbackTitle}>{title}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[[1, "thumbs-up", c.gain, "Helpful"], [-1, "thumbs-down", c.loss, "Not helpful"]].map(([r, icon, col, label]) => (
          <Pressable key={r} style={[s.thumb, sent === r && { backgroundColor: c.soft(col), borderColor: col }]} onPress={() => send(r)} accessibilityLabel={label}>
            <Ionicons name={sent === r ? icon : `${icon}-outline`} size={19} color={sent === r ? col : c.textSecondary} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  muted: { color: c.textSecondary, fontSize: 14 },
  small: { color: c.muted, fontSize: 12, marginTop: 4 },
  body: { color: c.text, fontSize: 15, lineHeight: 23 },
  lead: { color: c.text, fontSize: 16, lineHeight: 25, fontWeight: "500" },
  subhead: { fontWeight: "700", color: c.text, marginTop: 16, marginBottom: 4, fontSize: 14 },
  hero: { backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 20, marginTop: 8 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  company: { fontSize: 21, fontWeight: "800", color: c.text, letterSpacing: -0.4 },
  scoreBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  scoreBadgeText: { fontWeight: "800" },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" },
  price: { fontSize: 38, fontWeight: "800", color: c.text, letterSpacing: -1.2, fontVariant: ["tabular-nums"] },
  change: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  changeText: { fontWeight: "800", fontVariant: ["tabular-nums"] },
  stats: { flexDirection: "row", gap: 8, marginTop: 16 },
  rangeTrack: { height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt },
  rangeFill: { height: 6, borderRadius: 3, backgroundColor: c.primarySoft },
  rangeMarker: { position: "absolute", top: -5, width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: c.primary, borderWidth: 3, borderColor: c.surface },
  twoCol: { flexDirection: "row", gap: 8, marginTop: 14 },
  mini: { flex: 1, borderRadius: 14, padding: 12 },
  miniHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  miniTitle: { fontWeight: "800", fontSize: 13 },
  miniText: { color: c.text, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  risk: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 14, marginTop: 14 },
  riskHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" },
  riskNum: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  riskTitle: { flex: 1, fontWeight: "700", color: c.text, fontSize: 15, minWidth: 140 },
  quote: { flexDirection: "row", gap: 10, marginTop: 10 },
  quoteBar: { width: 3, borderRadius: 2, opacity: 0.6 },
  quoteText: { flex: 1, color: c.textSecondary, fontStyle: "italic", fontSize: 13, lineHeight: 19 },
  timelineRow: { flexDirection: "row", gap: 12 },
  timelineRail: { width: 14, alignItems: "center" },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  timelineLine: { flex: 1, width: 2, backgroundColor: c.border, marginTop: 4 },
  link: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 },
  linkText: { fontWeight: "700" },
  trendRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 10 },
  trendIcon: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 1 },
  table: { borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: c.border },
  tr: { flexDirection: "row", paddingVertical: 9, paddingHorizontal: 10 },
  thRow: { backgroundColor: c.surfaceAlt },
  trAlt: { backgroundColor: c.dark ? "rgba(255,255,255,0.02)" : "rgba(10,15,30,0.02)" },
  td: { flex: 1, fontSize: 12, color: c.text, textAlign: "right", fontVariant: ["tabular-nums"] },
  th: { fontWeight: "700", color: c.muted },
  overall: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, padding: 14, marginBottom: 12 },
  overallScore: { fontSize: 40, fontWeight: "800", letterSpacing: -1 },
  overallLabel: { fontSize: 18, fontWeight: "800" },
  traceRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border },
  feedback: { backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 16, marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  feedbackTitle: { flex: 1, fontWeight: "700", color: c.text, fontSize: 15 },
  thumb: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  progressBadge: { width: 60, height: 60, borderRadius: 20, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center" },
  progressTitle: { fontSize: 22, fontWeight: "800", color: c.text, marginTop: 14, marginBottom: 4, textAlign: "center", letterSpacing: -0.4 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, alignSelf: "stretch", marginTop: 20, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: c.primary },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  stepIcon: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 15, color: c.muted },
}));
