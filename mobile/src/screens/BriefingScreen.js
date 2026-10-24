import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { colors, formatMoney, riskColors, scoreColor, scoreLabel, sections } from "../theme";
import { Bullets, Pill, PrimaryButton, ScoreBar, SectionCard, TickerAvatar } from "../components/ui";

// Pipeline steps, matched against the progress text the API writes (server/src/agents/orchestrator.js)
const STEPS = [
  { match: "Looking up", label: "Finding the company", icon: "search-outline" },
  { match: "Fetching", label: "Pulling quote and SEC financials", icon: "cloud-download-outline" },
  { match: "Reading", label: "Reading the latest 10-K", icon: "book-outline" },
  { match: "Analysts", label: "4 analysts at work", icon: "people-outline" },
  { match: "Writing", label: "Writing your briefing", icon: "create-outline" },
  { match: "Compliance", label: "Compliance review", icon: "shield-checkmark-outline" },
  { match: "Evaluating", label: "Scoring quality", icon: "ribbon-outline" },
];

export default function BriefingScreen({ id, onBack }) {
  const [briefing, setBriefing] = useState(null);
  const [error, setError] = useState(null);

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

  const back = (
    <Pressable onPress={onBack} style={styles.back} hitSlop={10}>
      <Ionicons name="arrow-back" size={20} color={colors.primary} />
      <Text style={styles.backText}>Back</Text>
    </Pressable>
  );

  if (error) return <Message back={back} icon="cloud-offline-outline" color={colors.red} title="Couldn't load this briefing" text={error} onBack={onBack} />;
  if (!briefing || briefing.status === "running") return <Progress back={back} briefing={briefing} />;
  if (briefing.status === "failed") {
    return <Message back={back} icon="sad-outline" color={colors.amber} title={`We couldn't brief ${briefing.ticker}`} text={briefing.error} onBack={onBack} />;
  }

  const c = briefing.content;
  const evaluation = briefing.evaluations?.[0];
  const q = c.snapshot;
  const up = (q.change ?? 0) >= 0;
  const trend = up ? { color: colors.green, soft: colors.greenSoft, icon: "trending-up" } : { color: colors.red, soft: colors.redSoft, icon: "trending-down" };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      {back}

      {/* Hero: company + price */}
      <View style={styles.hero}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TickerAvatar ticker={c.company.ticker} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={styles.company} numberOfLines={2}>{c.company.name}</Text>
            <Text style={styles.muted}>{c.company.ticker}{c.company.industry ? ` · ${c.company.industry}` : ""}</Text>
          </View>
          {evaluation && <Pill text={`★ ${Number(evaluation.overall).toFixed(1)}`} color={scoreColor(evaluation.overall)} />}
        </View>
        <View style={styles.priceRow}>
          <Text style={styles.price}>${q.price?.toFixed(2)}</Text>
          <View style={[styles.change, { backgroundColor: trend.soft }]}>
            <Ionicons name={trend.icon} size={16} color={trend.color} />
            <Text style={{ color: trend.color, fontWeight: "800" }}>
              {up ? "+" : ""}{q.change?.toFixed(2)} ({up ? "+" : ""}{q.changePercent?.toFixed(2)}%)
            </Text>
          </View>
        </View>
        <View style={styles.statsGrid}>
          <Stat icon="business-outline" color="#4F46E5" label="Market cap" value={q.marketCapMillions ? formatMoney(q.marketCapMillions * 1e6) : "n/a"} />
          <Stat icon="calculator-outline" color="#0284C7" label="P/E (TTM)" value={q.peRatio ? q.peRatio.toFixed(1) : "n/a"} />
          <Stat icon="swap-vertical-outline" color="#D97706" label="52-week range" value={q.week52Low && q.week52High ? `$${q.week52Low.toFixed(0)}–${q.week52High.toFixed(0)}` : "n/a"} />
          <Stat icon="pulse-outline" color="#E11D48" label="Beta" value={q.beta ? q.beta.toFixed(2) : "n/a"} />
        </View>
        {q.week52Low && q.week52High && <RangeBar low={q.week52Low} high={q.week52High} price={q.price} />}
        <Text style={styles.small}>Quote as of {new Date(q.asOf).toLocaleString()}</Text>
      </View>

      <SectionCard title="Quick read" section={sections.summary} right={<Pill text="30 sec" color={sections.summary.color} />}>
        <Text style={styles.body}>{c.executive_summary}</Text>
      </SectionCard>

      <SectionCard title="Key takeaways" section={sections.takeaways}>
        <Bullets items={c.key_takeaways} color={sections.takeaways.color} />
      </SectionCard>

      <SectionCard title="Market today" section={sections.market}>
        <Text style={[styles.body, { marginBottom: 8 }]}>{c.market.commentary}</Text>
        <Bullets items={c.market.key_stats} color={sections.market.color} />
      </SectionCard>

      <SectionCard title="Financials" section={sections.financials} right={<Pill text="SEC data" color={sections.financials.color} />}>
        <FinancialTable financials={c.financials} />
        <Text style={[styles.body, { marginTop: 12 }]}>{c.fundamentals.summary}</Text>
        {c.fundamentals.trends.map((t) => <Trend key={t.metric} trend={t} />)}
        <View style={styles.twoCol}>
          <View style={[styles.miniCard, { backgroundColor: colors.greenSoft }]}>
            <Text style={[styles.miniTitle, { color: colors.green }]}>👍 Strengths</Text>
            {c.fundamentals.strengths.map((s, i) => <Text key={i} style={styles.miniText}>{s}</Text>)}
          </View>
          <View style={[styles.miniCard, { backgroundColor: colors.amberSoft }]}>
            <Text style={[styles.miniTitle, { color: colors.amber }]}>👀 Watch</Text>
            {c.fundamentals.concerns.map((s, i) => <Text key={i} style={styles.miniText}>{s}</Text>)}
          </View>
        </View>
      </SectionCard>

      <SectionCard title="The business" section={sections.business}>
        <Text style={styles.body}>{c.business.business_overview}</Text>
        {c.business.segments.length > 0 && (
          <View style={styles.segmentWrap}>
            {c.business.segments.map((s, i) => <Pill key={i} text={s} color={sections.business.color} />)}
          </View>
        )}
        <Text style={styles.subhead}>Management outlook</Text>
        <Text style={styles.body}>{c.business.management_outlook}</Text>
      </SectionCard>

      <SectionCard title="Top risks" section={sections.risks} right={<Pill text="10-K Item 1A" color={sections.risks.color} />}>
        <Text style={[styles.body, { marginBottom: 4 }]}>{c.risks.overview}</Text>
        {c.risks.top_risks.map((r, i) => (
          <View key={r.title} style={styles.risk}>
            <View style={styles.riskHead}>
              <View style={[styles.riskNum, { backgroundColor: sections.risks.soft }]}>
                <Text style={{ color: sections.risks.color, fontWeight: "800" }}>{i + 1}</Text>
              </View>
              <Text style={styles.riskTitle}>{r.title}</Text>
            </View>
            <Pill text={r.category} color={riskColors[r.category] ?? colors.muted} />
            <Text style={[styles.body, { marginTop: 6 }]}>{r.summary}</Text>
            <View style={styles.quote}>
              <Ionicons name="chatbox-ellipses-outline" size={14} color={colors.muted} />
              <Text style={styles.quoteText}>“{r.evidence}”</Text>
            </View>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Recent filings" section={sections.filings}>
        {c.business.recent_events.map((e, i) => (
          <View key={i} style={styles.timelineRow}>
            <View style={styles.timelineDot} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Pill text={e.form} color={sections.filings.color} />
                <Text style={styles.small}>{e.date}</Text>
              </View>
              <Text style={[styles.body, { marginTop: 4 }]}>{e.summary}</Text>
            </View>
          </View>
        ))}
        {c.sources.latest10K && (
          <Pressable style={styles.linkButton} onPress={() => Linking.openURL(c.sources.latest10K)}>
            <Ionicons name="open-outline" size={16} color={sections.filings.color} />
            <Text style={[styles.linkText, { color: sections.filings.color }]}>Open the latest 10-K on SEC.gov</Text>
          </Pressable>
        )}
      </SectionCard>

      <SectionCard title="Client talking points" section={sections.talking}>
        <Bullets items={c.talking_points} color={sections.talking.color} />
      </SectionCard>

      <SectionCard title="Questions to consider" section={sections.questions}>
        <Bullets items={c.questions_to_consider} color={sections.questions.color} />
      </SectionCard>

      {evaluation && <QualityCard evaluation={evaluation} compliance={c.compliance} logs={briefing.agent_logs} />}

      <Feedback id={briefing.id} />

      <View style={styles.disclaimer}>
        <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
        <Text style={styles.disclaimerText}>{c.disclaimer}</Text>
      </View>
    </ScrollView>
  );
}

function Progress({ back, briefing }) {
  const progress = briefing?.progress ?? "";
  const current = Math.max(0, STEPS.findIndex((s) => progress.startsWith(s.match)));
  const pct = Math.round(((current + 0.5) / STEPS.length) * 100);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {back}
      <View style={[styles.hero, { alignItems: "center" }]}>
        <View style={styles.progressBadge}>
          <Ionicons name="sparkles" size={28} color={colors.white} />
        </View>
        <Text style={styles.progressTitle}>Researching {briefing?.ticker ?? ""}</Text>
        <Text style={styles.muted}>This usually takes about a minute. Feel free to leave and come back.</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
        <Text style={[styles.small, { color: colors.primary, fontWeight: "700" }]}>{pct}%</Text>
      </View>

      <View style={[styles.hero, { marginTop: 14 }]}>
        {STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <View key={s.match} style={styles.stepRow}>
              <View style={[styles.stepIcon, { backgroundColor: done ? colors.greenSoft : active ? colors.primarySoft : colors.bg }]}>
                {done ? <Ionicons name="checkmark" size={18} color={colors.green} /> : active ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name={s.icon} size={16} color={colors.muted} />}
              </View>
              <Text style={[styles.stepText, done && { color: colors.green }, active && { color: colors.primary, fontWeight: "800" }]}>{s.label}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function Message({ back, icon, color, title, text, onBack }) {
  return (
    <View style={{ flex: 1, padding: 16 }}>
      {back}
      <View style={[styles.hero, { alignItems: "center", marginTop: 30 }]}>
        <Ionicons name={icon} size={44} color={color} />
        <Text style={styles.progressTitle}>{title}</Text>
        <Text style={[styles.muted, { textAlign: "center", marginTop: 6 }]}>{text}</Text>
        <PrimaryButton title="Try another ticker" icon="search" onPress={onBack} style={{ marginTop: 18, alignSelf: "stretch" }} />
      </View>
    </View>
  );
}

function Stat({ icon, color, label, value }) {
  return (
    <View style={styles.stat}>
      <View style={[styles.statIcon, { backgroundColor: `${color}1A` }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>{value}</Text>
      </View>
    </View>
  );
}

function RangeBar({ low, high, price }) {
  const pos = Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
  return (
    <View style={{ marginTop: 14 }}>
      <View style={styles.rangeTrack}>
        <View style={[styles.rangeMarker, { left: `${pos}%` }]} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text style={styles.small}>52w low ${low.toFixed(0)}</Text>
        <Text style={styles.small}>52w high ${high.toFixed(0)}</Text>
      </View>
    </View>
  );
}

const TREND = {
  up: { icon: "arrow-up-circle", color: colors.green },
  down: { icon: "arrow-down-circle", color: colors.red },
  flat: { icon: "remove-circle", color: colors.muted },
  mixed: { icon: "swap-vertical", color: colors.amber },
};

function Trend({ trend }) {
  const t = TREND[trend.direction] ?? TREND.flat;
  return (
    <View style={styles.trendRow}>
      <Ionicons name={t.icon} size={20} color={t.color} />
      <Text style={[styles.body, { flex: 1 }]}>
        <Text style={{ fontWeight: "800" }}>{trend.metric}: </Text>{trend.detail}
      </Text>
    </View>
  );
}

function FinancialTable({ financials }) {
  const rows = [["Revenue", "revenue"], ["Operating income", "operatingIncome"], ["Net income", "netIncome"], ["Diluted EPS", "epsDiluted"], ["Cash", "cash"], ["Long-term debt", "longTermDebt"]]
    .filter(([, k]) => financials[k]?.length);
  const years = [...new Set(rows.flatMap(([, k]) => financials[k].map((p) => p.year)))].sort().slice(-4);
  if (!rows.length) return <Text style={styles.muted}>No SEC financial data available for this company.</Text>;
  return (
    <View style={styles.table}>
      <View style={[styles.tr, { backgroundColor: sections.financials.soft }]}>
        <Text style={[styles.td, styles.th, { flex: 1.6, textAlign: "left" }]}>USD</Text>
        {years.map((y) => <Text key={y} style={[styles.td, styles.th]}>{y}</Text>)}
      </View>
      {rows.map(([label, key], i) => (
        <View key={key} style={[styles.tr, i % 2 === 1 && { backgroundColor: "#FAFAFA" }]}>
          <Text style={[styles.td, { flex: 1.6, textAlign: "left", fontWeight: "600" }]}>{label}</Text>
          {years.map((y) => {
            const v = financials[key].find((p) => p.year === y)?.value;
            return <Text key={y} style={styles.td}>{v == null ? "–" : key === "epsDiluted" ? `$${v.toFixed(2)}` : formatMoney(v)}</Text>;
          })}
        </View>
      ))}
    </View>
  );
}

function QualityCard({ evaluation, compliance, logs = [] }) {
  const [showTrace, setShowTrace] = useState(false);
  const checks = evaluation.checks ?? {};
  const totalTokens = logs.reduce((s, l) => s + (l.input_tokens ?? 0) + (l.output_tokens ?? 0), 0);
  const overall = Number(evaluation.overall);
  return (
    <SectionCard title="How reliable is this?" section={sections.quality}>
      <View style={[styles.overall, { backgroundColor: `${scoreColor(overall)}1A` }]}>
        <Text style={[styles.overallScore, { color: scoreColor(overall) }]}>{overall.toFixed(1)}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.overallLabel, { color: scoreColor(overall) }]}>{scoreLabel(overall)}</Text>
          <Text style={styles.small}>Scored by an independent AI reviewer against the source data</Text>
        </View>
      </View>
      <ScoreBar label="Accuracy" value={evaluation.faithfulness} />
      <ScoreBar label="Completeness" value={evaluation.completeness} />
      <ScoreBar label="Compliance" value={evaluation.compliance} />
      <ScoreBar label="Clarity" value={evaluation.clarity} />
      <Text style={[styles.body, { marginTop: 10 }]}>{evaluation.rationale}</Text>

      {evaluation.issues?.length > 0 && (
        <View style={[styles.miniCard, { backgroundColor: colors.amberSoft, marginTop: 10 }]}>
          <Text style={[styles.miniTitle, { color: colors.amber }]}>Double-check these claims</Text>
          {evaluation.issues.map((s, i) => <Text key={i} style={styles.miniText}>• {s}</Text>)}
        </View>
      )}

      <View style={styles.checkRow}>
        <Pill text={`✓ ${checks.passed}/${checks.total} automated checks`} color={checks.passed === checks.total ? colors.green : colors.amber} />
        <Pill text={`${compliance?.issues_found?.length ?? 0} compliance edits`} color={colors.primary} />
      </View>

      <Pressable style={styles.linkButton} onPress={() => setShowTrace(!showTrace)}>
        <Ionicons name={showTrace ? "chevron-up" : "chevron-down"} size={16} color={colors.primary} />
        <Text style={[styles.linkText, { color: colors.primary }]}>{showTrace ? "Hide" : "Show"} agent trace · {logs.length} calls · {totalTokens.toLocaleString()} tokens</Text>
      </Pressable>
      {showTrace && logs.map((l, i) => (
        <View key={i} style={styles.traceRow}>
          <Ionicons name={l.status === "ok" ? "checkmark-circle" : "close-circle"} size={14} color={l.status === "ok" ? colors.green : colors.red} />
          <Text style={[styles.small, { flex: 1, marginTop: 0 }]}>{l.agent.replace(/_/g, " ")}</Text>
          <Text style={[styles.small, { marginTop: 0 }]}>{(l.latency_ms / 1000).toFixed(1)}s · {((l.input_tokens ?? 0) + (l.output_tokens ?? 0)).toLocaleString()} tok</Text>
        </View>
      ))}
    </SectionCard>
  );
}

function Feedback({ id }) {
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
    <View style={styles.feedback}>
      <Text style={styles.feedbackTitle}>{title}</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable style={[styles.thumb, sent === 1 && { backgroundColor: colors.greenSoft, borderColor: colors.green }]} onPress={() => send(1)} accessibilityLabel="Helpful">
          <Ionicons name="thumbs-up" size={20} color={sent === 1 ? colors.green : colors.muted} />
        </Pressable>
        <Pressable style={[styles.thumb, sent === -1 && { backgroundColor: colors.redSoft, borderColor: colors.red }]} onPress={() => send(-1)} accessibilityLabel="Not helpful">
          <Ionicons name="thumbs-down" size={20} color={sent === -1 ? colors.red : colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

const cardShadow = { shadowColor: "#1E1B4B", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 };

const styles = StyleSheet.create({
  back: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, alignSelf: "flex-start" },
  backText: { color: colors.primary, fontWeight: "700", fontSize: 16 },
  muted: { color: colors.muted },
  small: { color: colors.muted, fontSize: 12, marginTop: 8 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  subhead: { fontWeight: "800", color: colors.text, marginTop: 14, marginBottom: 4 },
  hero: { backgroundColor: colors.card, borderRadius: 22, padding: 18, marginTop: 8, ...cardShadow },
  company: { fontSize: 20, fontWeight: "800", color: colors.text },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" },
  price: { fontSize: 34, fontWeight: "800", color: colors.text },
  change: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  stat: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bg, borderRadius: 14, padding: 10, width: "48.5%" },
  statIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statLabel: { color: colors.muted, fontSize: 11 },
  statValue: { fontSize: 15, fontWeight: "800", color: colors.text },
  rangeTrack: { height: 8, borderRadius: 4, backgroundColor: colors.primarySoft },
  rangeMarker: { position: "absolute", top: -4, width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.white },
  table: { borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  tr: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 8 },
  td: { flex: 1, fontSize: 12, color: colors.text, textAlign: "right" },
  th: { fontWeight: "800", color: sections.financials.color },
  trendRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 8 },
  twoCol: { flexDirection: "row", gap: 8, marginTop: 12 },
  miniCard: { flex: 1, borderRadius: 14, padding: 12 },
  miniTitle: { fontWeight: "800", marginBottom: 6 },
  miniText: { color: colors.text, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  segmentWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  risk: { backgroundColor: "#FFF8F9", borderRadius: 14, padding: 12, marginTop: 10 },
  riskHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  riskNum: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  riskTitle: { flex: 1, fontWeight: "800", color: colors.text, fontSize: 15 },
  quote: { flexDirection: "row", gap: 6, marginTop: 8, backgroundColor: colors.card, borderRadius: 10, padding: 8 },
  quoteText: { flex: 1, color: colors.muted, fontStyle: "italic", fontSize: 13, lineHeight: 18 },
  timelineRow: { flexDirection: "row", gap: 12, paddingVertical: 8, borderLeftWidth: 2, borderLeftColor: sections.filings.soft, marginLeft: 5, paddingLeft: 14 },
  timelineDot: { position: "absolute", left: -7, top: 14, width: 12, height: 12, borderRadius: 6, backgroundColor: sections.filings.color },
  linkButton: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  linkText: { fontWeight: "700" },
  overall: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, padding: 14, marginBottom: 10 },
  overallScore: { fontSize: 38, fontWeight: "900" },
  overallLabel: { fontSize: 18, fontWeight: "800" },
  checkRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  traceRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border },
  feedback: { backgroundColor: colors.primarySoft, borderRadius: 18, padding: 16, marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  feedbackTitle: { flex: 1, fontWeight: "800", color: colors.primaryDark, fontSize: 15 },
  thumb: { width: 46, height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  disclaimer: { flexDirection: "row", gap: 8, marginTop: 20, paddingHorizontal: 4 },
  disclaimerText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 16 },
  progressBadge: { width: 64, height: 64, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  progressTitle: { fontSize: 22, fontWeight: "800", color: colors.text, marginTop: 14, marginBottom: 4, textAlign: "center" },
  progressTrack: { height: 10, borderRadius: 5, backgroundColor: colors.primarySoft, alignSelf: "stretch", marginTop: 18, overflow: "hidden" },
  progressFill: { height: 10, borderRadius: 5, backgroundColor: colors.primary },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  stepIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 15, color: colors.muted, fontWeight: "600" },
});
