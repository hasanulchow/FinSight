import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme";
import { Bullets, Pill, SectionCard } from "./ui";
import CandleChart from "./CandleChart";

export const techSection = { color: "#0EA5E9", soft: "#E0F2FE", icon: "analytics-outline" };
const BIAS = {
  bullish: { color: colors.green, soft: colors.greenSoft, icon: "trending-up", label: "Bullish" },
  bearish: { color: colors.red, soft: colors.redSoft, icon: "trending-down", label: "Bearish" },
  neutral: { color: colors.amber, soft: colors.amberSoft, icon: "swap-horizontal", label: "Neutral" },
};

/**
 * Chart + indicator tiles + AI read. `snapshot` and `chart` come from the server's indicator engine;
 * `analysis` (optional) from the Technical Analyst agent. `onExplain` lets standalone screens request it.
 */
export default function TechnicalsCard({ snapshot, chart, analysis, onExplain, explaining }) {
  const [showSignals, setShowSignals] = useState(false);
  if (!snapshot) return null;
  const s = snapshot;
  const bias = BIAS[s.rating.bias] ?? BIAS.neutral;
  const rsiColor = s.rsi14 >= 70 ? colors.red : s.rsi14 <= 30 ? colors.green : colors.text;

  return (
    <SectionCard title="Chart & technicals" section={techSection} right={<Pill text={`As of ${s.asOf}`} color={techSection.color} />}>
      <View style={[styles.rating, { backgroundColor: bias.soft }]}>
        <Ionicons name={bias.icon} size={22} color={bias.color} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.ratingTitle, { color: bias.color }]}>{bias.label} setup · {s.trend}</Text>
          <Text style={styles.small}>{s.rating.bullish} bullish vs {s.rating.bearish} bearish signals (rule-based, not advice)</Text>
        </View>
      </View>

      <CandleChart data={chart} />

      <View style={styles.tiles}>
        <Tile label="RSI (14)" value={s.rsi14 ?? "–"} color={rsiColor} hint={s.rsi14 >= 70 ? "Overbought" : s.rsi14 <= 30 ? "Oversold" : "Neutral zone"} />
        <Tile label="MACD hist." value={s.macd.histogram ?? "–"} color={s.macd.histogram >= 0 ? colors.green : colors.red} hint={s.macd.histogram >= 0 ? "Momentum up" : "Momentum down"} />
        <Tile label="vs 200-day" value={s.moving_averages.sma200 ? `${(((s.price - s.moving_averages.sma200) / s.moving_averages.sma200) * 100).toFixed(1)}%` : "–"} color={s.price >= (s.moving_averages.sma200 ?? 0) ? colors.green : colors.red} hint={`SMA200 ${s.moving_averages.sma200 ?? "–"}`} />
        <Tile label="ATR (14)" value={s.atr_pct != null ? `${s.atr_pct}%` : "–"} hint="Avg daily range" />
        <Tile label="Volume" value={s.volume.ratio != null ? `${s.volume.ratio}x` : "–"} color={s.volume.ratio >= 2 ? colors.amber : colors.text} hint="vs 20-day avg" />
        <Tile label="1-year" value={s.performance_pct["1y"] != null ? `${s.performance_pct["1y"]}%` : "–"} color={(s.performance_pct["1y"] ?? 0) >= 0 ? colors.green : colors.red} hint={`1M ${s.performance_pct["1m"] ?? "–"}%`} />
      </View>

      <View style={styles.levels}>
        <LevelColumn title="Support" levels={s.levels.support} color={colors.green} />
        <LevelColumn title="Resistance" levels={s.levels.resistance} color={colors.red} />
      </View>

      <Pressable style={styles.link} onPress={() => setShowSignals(!showSignals)}>
        <Ionicons name={showSignals ? "chevron-up" : "chevron-down"} size={16} color={techSection.color} />
        <Text style={[styles.linkText, { color: techSection.color }]}>{showSignals ? "Hide" : "Show"} {s.signals.length} signals</Text>
      </Pressable>
      {showSignals && s.signals.map((sig) => (
        <View key={sig.id} style={styles.signal}>
          <View style={[styles.dot, { backgroundColor: BIAS[sig.bias]?.color ?? colors.muted }]} />
          <Text style={styles.body}>{sig.label}</Text>
        </View>
      ))}

      {analysis ? (
        <View style={styles.ai}>
          <View style={styles.aiHeader}>
            <Ionicons name="sparkles" size={16} color={techSection.color} />
            <Text style={[styles.aiTitle, { color: techSection.color }]}>AI chart read</Text>
          </View>
          <Text style={styles.body}>{analysis.summary}</Text>
          <Text style={styles.subhead}>Trend</Text>
          <Text style={styles.body}>{analysis.trend}</Text>
          <Text style={styles.subhead}>Momentum</Text>
          <Text style={styles.body}>{analysis.momentum}</Text>
          <Text style={styles.subhead}>Volatility & volume</Text>
          <Text style={styles.body}>{analysis.volatility}</Text>
          <Text style={styles.subhead}>Key levels</Text>
          <Text style={styles.body}>{analysis.key_levels}</Text>
          <View style={styles.scenarios}>
            <View style={[styles.scenario, { backgroundColor: colors.greenSoft }]}>
              <Text style={[styles.scenarioTitle, { color: colors.green }]}>Bullish case</Text>
              <Text style={styles.scenarioText}>{analysis.bullish_scenario}</Text>
            </View>
            <View style={[styles.scenario, { backgroundColor: colors.redSoft }]}>
              <Text style={[styles.scenarioTitle, { color: colors.red }]}>Bearish case</Text>
              <Text style={styles.scenarioText}>{analysis.bearish_scenario}</Text>
            </View>
          </View>
          {analysis.signals_explained?.length > 0 && (
            <>
              <Text style={styles.subhead}>What the signals mean</Text>
              <Bullets items={analysis.signals_explained.map((x) => `${x.signal}: ${x.meaning}`)} color={techSection.color} />
            </>
          )}
          <View style={styles.tip}>
            <Ionicons name="school-outline" size={16} color={colors.primary} />
            <Text style={styles.tipText}>{analysis.beginner_tip}</Text>
          </View>
        </View>
      ) : onExplain ? (
        <Pressable style={styles.explain} onPress={onExplain} disabled={explaining}>
          {explaining ? <ActivityIndicator color={techSection.color} /> : <Ionicons name="sparkles" size={16} color={techSection.color} />}
          <Text style={[styles.linkText, { color: techSection.color }]}>{explaining ? "Reading the chart…" : "Explain this chart with AI"}</Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

function Tile({ label, value, hint, color = colors.text }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, { color }]}>{value}</Text>
      {hint ? <Text style={styles.tileHint} numberOfLines={1}>{hint}</Text> : null}
    </View>
  );
}

function LevelColumn({ title, levels, color }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.levelTitle, { color }]}>{title}</Text>
      {levels.length ? levels.map((l) => (
        <Text key={l.level} style={styles.levelRow}>${l.level} <Text style={styles.small}>({l.distance_pct > 0 ? "+" : ""}{l.distance_pct}%)</Text></Text>
      )) : <Text style={styles.small}>None nearby</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  rating: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, padding: 12, marginBottom: 12 },
  ratingTitle: { fontWeight: "800", fontSize: 15, textTransform: "capitalize" },
  small: { color: colors.muted, fontSize: 12 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21, flex: 1 },
  subhead: { fontWeight: "800", color: colors.text, marginTop: 10, marginBottom: 2 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  tile: { width: "31.5%", backgroundColor: colors.bg, borderRadius: 12, padding: 9 },
  tileLabel: { color: colors.muted, fontSize: 11 },
  tileValue: { fontSize: 16, fontWeight: "800", marginTop: 2 },
  tileHint: { color: colors.muted, fontSize: 10, marginTop: 1 },
  levels: { flexDirection: "row", gap: 12, marginTop: 14, backgroundColor: colors.bg, borderRadius: 12, padding: 12 },
  levelTitle: { fontWeight: "800", marginBottom: 4 },
  levelRow: { color: colors.text, fontSize: 14, marginBottom: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  linkText: { fontWeight: "700" },
  signal: { flexDirection: "row", gap: 8, marginTop: 6, alignItems: "flex-start" },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  ai: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  aiHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  aiTitle: { fontWeight: "800" },
  scenarios: { flexDirection: "row", gap: 8, marginTop: 12 },
  scenario: { flex: 1, borderRadius: 12, padding: 10 },
  scenarioTitle: { fontWeight: "800", marginBottom: 4 },
  scenarioText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  tip: { flexDirection: "row", gap: 8, backgroundColor: colors.primarySoft, borderRadius: 12, padding: 10, marginTop: 12 },
  tipText: { flex: 1, color: colors.primaryDark, fontSize: 13, lineHeight: 18 },
  explain: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, borderWidth: 1.5, borderColor: techSection.soft, borderRadius: 12, padding: 12 },
});
