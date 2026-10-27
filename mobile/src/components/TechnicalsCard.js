import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme } from "../theme";
import { Bullets, Pill, SectionCard, Stat } from "./ui";
import CandleChart from "./CandleChart";

/**
 * Chart + indicator tiles + AI read. `snapshot` and `chart` come from the server's indicator engine;
 * `analysis` (optional) from the Technical Analyst agent. `onExplain` lets standalone screens request it.
 */
export default function TechnicalsCard({ snapshot, chart, analysis, onExplain, explaining }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [showSignals, setShowSignals] = useState(false);
  if (!snapshot) return null;
  const t = snapshot;
  const sec = sections.technicals;
  const BIAS = {
    bullish: { color: c.gain, icon: "trending-up", label: "Bullish" },
    bearish: { color: c.loss, icon: "trending-down", label: "Bearish" },
    neutral: { color: c.warn, icon: "swap-horizontal", label: "Neutral" },
  };
  const bias = BIAS[t.rating.bias] ?? BIAS.neutral;
  const rsiColor = t.rsi14 >= 70 ? c.loss : t.rsi14 <= 30 ? c.gain : c.text;
  const vs200 = t.moving_averages.sma200 ? ((t.price - t.moving_averages.sma200) / t.moving_averages.sma200) * 100 : null;

  return (
    <SectionCard title="Chart & technicals" subtitle={`Daily bars · as of ${t.asOf}`} section={sec}>
      <View style={[s.rating, { backgroundColor: c.soft(bias.color) }]}>
        <View style={[s.ratingIcon, { backgroundColor: c.soft(bias.color) }]}>
          <Ionicons name={bias.icon} size={20} color={bias.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.ratingTitle, { color: bias.color }]}>{bias.label} setup · {t.trend}</Text>
          <Text style={s.small}>{t.rating.bullish} bullish vs {t.rating.bearish} bearish signals · rule-based, not advice</Text>
        </View>
      </View>

      <CandleChart data={chart} />

      <View style={s.grid}>
        <Stat label="RSI (14)" value={t.rsi14 ?? "–"} color={rsiColor} hint={t.rsi14 >= 70 ? "Overbought" : t.rsi14 <= 30 ? "Oversold" : "Neutral zone"} style={s.cell} />
        <Stat label="MACD hist." value={t.macd.histogram ?? "–"} color={t.macd.histogram >= 0 ? c.gain : c.loss} hint={t.macd.histogram >= 0 ? "Momentum up" : "Momentum down"} style={s.cell} />
        <Stat label="vs 200-day" value={vs200 != null ? `${vs200 >= 0 ? "+" : ""}${vs200.toFixed(1)}%` : "–"} color={vs200 >= 0 ? c.gain : c.loss} hint={`SMA200 ${t.moving_averages.sma200 ?? "–"}`} style={s.cell} />
        <Stat label="ATR (14)" value={t.atr_pct != null ? `${t.atr_pct}%` : "–"} hint="Avg daily range" style={s.cell} />
        <Stat label="Volume" value={t.volume.ratio != null ? `${t.volume.ratio}×` : "–"} color={t.volume.ratio >= 2 ? c.warn : c.text} hint="vs 20-day avg" style={s.cell} />
        <Stat label="1 year" value={t.performance_pct["1y"] != null ? `${t.performance_pct["1y"]}%` : "–"} color={(t.performance_pct["1y"] ?? 0) >= 0 ? c.gain : c.loss} hint={`1M ${t.performance_pct["1m"] ?? "–"}%`} style={s.cell} />
      </View>

      <View style={s.levels}>
        <LevelColumn title="Support" levels={t.levels.support} color={c.gain} />
        <View style={s.divider} />
        <LevelColumn title="Resistance" levels={t.levels.resistance} color={c.loss} />
      </View>

      <Pressable style={s.link} onPress={() => setShowSignals(!showSignals)}>
        <Ionicons name={showSignals ? "chevron-up" : "chevron-down"} size={16} color={sec.color} />
        <Text style={[s.linkText, { color: sec.color }]}>{showSignals ? "Hide" : "Show"} {t.signals.length} signals</Text>
      </Pressable>
      {showSignals && t.signals.map((sig) => (
        <View key={sig.id} style={s.signal}>
          <View style={[s.dot, { backgroundColor: BIAS[sig.bias]?.color ?? c.muted }]} />
          <Text style={s.body}>{sig.label}</Text>
        </View>
      ))}

      {analysis ? (
        <View style={s.ai}>
          <View style={s.aiHeader}>
            <Ionicons name="sparkles" size={15} color={sec.color} />
            <Text style={[s.aiTitle, { color: sec.color }]}>AI chart read</Text>
          </View>
          <Text style={s.lead}>{analysis.summary}</Text>
          {[["Trend", analysis.trend], ["Momentum", analysis.momentum], ["Volatility & volume", analysis.volatility], ["Key levels", analysis.key_levels]].map(([h, txt]) => (
            <View key={h}>
              <Text style={s.subhead}>{h}</Text>
              <Text style={s.body}>{txt}</Text>
            </View>
          ))}
          <View style={s.scenarios}>
            <View style={[s.scenario, { backgroundColor: c.gainSoft }]}>
              <Text style={[s.scenarioTitle, { color: c.gain }]}>Bullish case</Text>
              <Text style={s.scenarioText}>{analysis.bullish_scenario}</Text>
            </View>
            <View style={[s.scenario, { backgroundColor: c.lossSoft }]}>
              <Text style={[s.scenarioTitle, { color: c.loss }]}>Bearish case</Text>
              <Text style={s.scenarioText}>{analysis.bearish_scenario}</Text>
            </View>
          </View>
          {analysis.signals_explained?.length > 0 && (
            <>
              <Text style={s.subhead}>What the signals mean</Text>
              <Bullets items={analysis.signals_explained.map((x) => `${x.signal}: ${x.meaning}`)} color={sec.color} />
            </>
          )}
          <View style={s.tip}>
            <Ionicons name="school-outline" size={16} color={c.primary} />
            <Text style={s.tipText}>{analysis.beginner_tip}</Text>
          </View>
        </View>
      ) : onExplain ? (
        <Pressable style={({ hovered }) => [s.explain, { borderColor: c.soft(sec.color) }, hovered && { backgroundColor: c.soft(sec.color) }]} onPress={onExplain} disabled={explaining}>
          {explaining ? <ActivityIndicator color={sec.color} /> : <Ionicons name="sparkles" size={16} color={sec.color} />}
          <Text style={[s.linkText, { color: sec.color }]}>{explaining ? "Reading the chart…" : "Explain this chart with AI"}</Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

function LevelColumn({ title, levels, color }) {
  const s = useStyles();
  return (
    <View style={{ flex: 1 }}>
      <Text style={[s.levelTitle, { color }]}>{title}</Text>
      {levels.length ? levels.map((l) => (
        <View key={l.level} style={s.levelRow}>
          <Text style={s.levelValue}>${l.level}</Text>
          <Text style={s.small}>{l.distance_pct > 0 ? "+" : ""}{l.distance_pct}%</Text>
        </View>
      )) : <Text style={s.small}>None nearby</Text>}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  rating: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 12, marginBottom: 14 },
  ratingIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ratingTitle: { fontWeight: "800", fontSize: 15, textTransform: "capitalize" },
  small: { color: c.muted, fontSize: 12, marginTop: 1 },
  body: { color: c.text, fontSize: 14, lineHeight: 21, flex: 1 },
  lead: { color: c.text, fontSize: 15, lineHeight: 23, fontWeight: "500" },
  subhead: { fontWeight: "700", color: c.text, marginTop: 12, marginBottom: 3, fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  cell: { flexBasis: "31%", flexGrow: 1 },
  levels: { flexDirection: "row", gap: 14, marginTop: 12, backgroundColor: c.surfaceAlt, borderRadius: 14, padding: 14 },
  divider: { width: 1, backgroundColor: c.border },
  levelTitle: { fontWeight: "800", marginBottom: 6, fontSize: 13 },
  levelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  levelValue: { color: c.text, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  link: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 },
  linkText: { fontWeight: "700" },
  signal: { flexDirection: "row", gap: 10, marginTop: 8, alignItems: "flex-start" },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  ai: { marginTop: 16, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 14 },
  aiHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  aiTitle: { fontWeight: "800", fontSize: 13, letterSpacing: 0.2 },
  scenarios: { flexDirection: "row", gap: 8, marginTop: 14 },
  scenario: { flex: 1, borderRadius: 14, padding: 12 },
  scenarioTitle: { fontWeight: "800", marginBottom: 4, fontSize: 13 },
  scenarioText: { color: c.text, fontSize: 13, lineHeight: 19 },
  tip: { flexDirection: "row", gap: 8, backgroundColor: c.primarySoft, borderRadius: 12, padding: 12, marginTop: 14 },
  tipText: { flex: 1, color: c.text, fontSize: 13, lineHeight: 19 },
  explain: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16, borderWidth: 1, borderRadius: 14, padding: 13 },
}));
