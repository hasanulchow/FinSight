import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { colors } from "../theme";
import { Bullets, Pill, SectionCard } from "../components/ui";
import PayoffChart from "../components/PayoffChart";

const OPT = { color: "#0891B2", soft: "#CFFAFE", icon: "options-outline" };
const STRATS = [
  ["long_call", "Long call"], ["long_put", "Long put"], ["covered_call", "Covered call"], ["cash_secured_put", "Cash-secured put"],
  ["protective_put", "Protective put"], ["bull_call_spread", "Bull call spread"], ["bear_put_spread", "Bear put spread"],
  ["long_straddle", "Straddle"], ["long_strangle", "Strangle"], ["iron_condor", "Iron condor"],
];
const METRICS = [["price", "Price"], ["delta", "Delta"], ["prob_itm", "Prob. ITM %"], ["iv", "IV %"]];
const REGIME = { low: colors.green, normal: colors.primary, elevated: colors.amber, high: colors.red };
const money = (v) => (v == null ? "Unlimited" : `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString()}`);

/** Options center: volatility & expected move, strategy builder with payoff chart, option chain. */
export default function OptionsScreen({ ticker, onBack }) {
  const [ov, setOv] = useState(null);
  const [error, setError] = useState(null);
  const [expiration, setExpiration] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [strategyKey, setStrategyKey] = useState("long_call");
  const [strategy, setStrategy] = useState(null);
  const [stratBusy, setStratBusy] = useState(false);
  const [metric, setMetric] = useState("price");

  const load = useCallback(async (exp) => {
    setError(null);
    setOv(null);
    try {
      setOv(await api.options(ticker, { expiration: exp }));
    } catch (e) {
      setError(e.message);
    }
  }, [ticker]);

  useEffect(() => {
    load(expiration);
  }, [load, expiration]);

  const loadStrategy = useCallback(async (key, explain = false) => {
    setStratBusy(true);
    try {
      setStrategy(await api.optionStrategy(ticker, { strategy: key, expiration: ov?.expiration, explain }));
    } catch (e) {
      setError(e.message);
    }
    setStratBusy(false);
  }, [ticker, ov?.expiration]);

  useEffect(() => {
    if (ov) loadStrategy(strategyKey);
  }, [ov?.expiration, strategyKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function explainVol() {
    setAiBusy(true);
    try {
      const withAi = await api.options(ticker, { expiration: ov.expiration, explain: true });
      setOv(withAi);
    } catch (e) {
      setError(e.message);
    }
    setAiBusy(false);
  }

  const earningsBefore = ov?.next_earnings && ov.next_earnings.date <= ov.expiration;
  const regime = ov?.iv_vs_hv == null ? null : ov.iv_vs_hv < 0.8 ? "low" : ov.iv_vs_hv < 1.2 ? "normal" : ov.iv_vs_hv < 1.6 ? "elevated" : "high";
  const a = strategy?.analysis;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Pressable onPress={onBack} style={styles.back} hitSlop={10}>
        <Ionicons name="arrow-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <View style={styles.hero}>
        <Text style={styles.title}>{ticker} options</Text>
        {ov && <Text style={styles.muted}>Spot ${ov.spot} · {ov.dte} days to {ov.expiration}</Text>}
        {ov?.expirations && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 6 }}>
            {ov.expirations.map((e) => (
              <Pressable key={e} onPress={() => setExpiration(e)} style={[styles.chip, e === ov.expiration && styles.chipActive]}>
                <Text style={[styles.chipText, e === ov.expiration && { color: colors.white }]}>{new Date(`${e}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {!ov && !error && (
        <View style={styles.loading}>
          <ActivityIndicator color={OPT.color} />
          <Text style={styles.muted}>Loading options data… the first load can take up to a minute on the free data plan.</Text>
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {ov && (
        <>
          {ov.data_source === "model" && (
            <View style={styles.banner}>
              <Ionicons name="information-circle-outline" size={18} color={colors.primaryDark} />
              <Text style={styles.bannerText}>Strike prices and greeks are Black-Scholes estimates at the {ov.iv}% implied volatility from at-the-money option prices. A paid options data plan shows the live chain.</Text>
            </View>
          )}

          <SectionCard title="Volatility & expected move" section={OPT} right={regime ? <Pill text={`IV ${regime}`} color={REGIME[regime]} /> : null}>
            <View style={styles.tiles}>
              <Tile label="Implied vol" value={`${ov.iv}%`} color={OPT.color} />
              <Tile label="Hist. vol 20d" value={ov.hv20 != null ? `${ov.hv20}%` : "–"} />
              <Tile label="IV / HV" value={ov.iv_vs_hv ?? "–"} color={regime ? REGIME[regime] : colors.text} />
            </View>
            {earningsBefore && (
              <View style={styles.warn}>
                <Ionicons name="calendar" size={16} color={colors.amber} />
                <Text style={styles.warnText}>Earnings on {ov.next_earnings.date} fall before this expiration. Implied volatility usually drops sharply after the report.</Text>
              </View>
            )}
            <Text style={styles.subhead}>Expected move by {ov.expiration}</Text>
            <MoveBar spot={ov.spot} move={ov.expected_move} />
            <Text style={styles.small}>±${ov.expected_move.move} ({ov.expected_move.pct}%) · about 68% of outcomes land in this range{ov.straddle_price ? ` · ATM straddle $${ov.straddle_price}` : ""}</Text>
            <Text style={styles.subhead}>Chance of finishing above…</Text>
            {ov.levels.map((l) => (
              <View key={`${l.label}${l.level}`} style={styles.levelRow}>
                <Text style={styles.levelLabel}>${l.level} <Text style={styles.small}>{l.label}</Text></Text>
                <View style={styles.probTrack}><View style={[styles.probFill, { width: `${l.prob_above}%` }]} /></View>
                <Text style={styles.levelValue}>{l.prob_above}%</Text>
              </View>
            ))}
            {ov.flow && (
              <View style={[styles.tiles, { marginTop: 12 }]}>
                <Tile label="Put/call vol" value={ov.flow.put_call_volume_ratio ?? "–"} />
                <Tile label="Put/call OI" value={ov.flow.put_call_oi_ratio ?? "–"} />
                <Tile label="Max pain" value={ov.flow.max_pain ? `$${ov.flow.max_pain}` : "–"} />
              </View>
            )}
            {ov.ai ? (
              <View style={styles.ai}>
                <AiHeader />
                <Text style={styles.body}>{ov.ai.volatility_read}</Text>
                <Text style={[styles.body, { marginTop: 6 }]}>{ov.ai.expected_move_read}</Text>
                <Text style={styles.subhead}>Key risks</Text>
                <Bullets items={ov.ai.key_risks} color={OPT.color} />
                <Tip text={ov.ai.education_tip} />
              </View>
            ) : (
              <AiButton onPress={explainVol} busy={aiBusy} label="Explain the volatility picture" />
            )}
          </SectionCard>

          <SectionCard title="Strategy builder" section={{ ...OPT, icon: "construct-outline" }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {STRATS.map(([key, label]) => (
                <Pressable key={key} onPress={() => setStrategyKey(key)} style={[styles.chip, strategyKey === key && styles.chipActive]}>
                  <Text style={[styles.chipText, strategyKey === key && { color: colors.white }]}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {stratBusy && !strategy && <ActivityIndicator color={OPT.color} style={{ marginTop: 16 }} />}
            {strategy && a && (
              <View style={{ marginTop: 12, opacity: stratBusy ? 0.5 : 1 }}>
                <Text style={styles.strategyTitle}>{strategy.label} <Text style={styles.small}>· {strategy.view}</Text></Text>
                <View style={styles.legs}>
                  {strategy.legs.map((l, i) => (
                    <Pill key={i} text={`${l.side === "long" ? "Buy" : "Sell"} ${l.kind === "stock" ? "100 shares" : `${l.strike} ${l.kind}`} @ $${l.premium}`} color={l.side === "long" ? colors.green : colors.red} />
                  ))}
                </View>
                <PayoffChart curve={a.curve} spot={strategy.spot} breakevens={a.breakevens} expectedMove={ov.expected_move} />
                <View style={[styles.tiles, { marginTop: 12 }]}>
                  <Tile label="Max profit" value={money(a.max_profit)} color={colors.green} />
                  <Tile label="Max loss" value={a.unbounded_loss ? "Unlimited" : money(a.max_loss)} color={colors.red} />
                  <Tile label="Prob. of profit" value={`${a.probability_of_profit}%`} color={OPT.color} />
                </View>
                <View style={[styles.tiles, { marginTop: 8 }]}>
                  <Tile label={a.net_premium >= 0 ? "Net credit" : "Net debit"} value={`$${Math.abs(a.net_premium).toLocaleString()}`} />
                  <Tile label="Breakeven" value={a.breakevens.length ? a.breakevens.map((b) => `$${b}`).join(" / ") : "–"} small />
                  <Tile label="Theta / day" value={`$${a.position_greeks.theta_per_day}`} color={a.position_greeks.theta_per_day >= 0 ? colors.green : colors.red} />
                </View>
                <Text style={styles.small}>Position greeks: delta {a.position_greeks.delta}, gamma {a.position_greeks.gamma}, vega ${a.position_greeks.vega_per_1pct} per 1% IV. Per 1 contract (100 shares).</Text>
                {strategy.ai ? (
                  <View style={styles.ai}>
                    <AiHeader />
                    <Text style={styles.body}>{strategy.ai.strategy_explanation}</Text>
                    <Text style={styles.subhead}>Key risks</Text>
                    <Bullets items={strategy.ai.key_risks} color={OPT.color} />
                  </View>
                ) : (
                  <AiButton onPress={() => loadStrategy(strategyKey, true)} busy={stratBusy} label="Explain this strategy" />
                )}
              </View>
            )}
          </SectionCard>

          <SectionCard title="Option chain" section={{ ...OPT, icon: "list-outline" }} right={<Pill text={ov.data_source === "market" ? "Live" : "Model"} color={ov.data_source === "market" ? colors.green : colors.amber} />}>
            <View style={styles.metricRow}>
              {METRICS.map(([key, label]) => (
                <Pressable key={key} onPress={() => setMetric(key)} style={[styles.metric, metric === key && styles.metricActive]}>
                  <Text style={[styles.metricText, metric === key && { color: OPT.color }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.chainHead}>
              <Text style={[styles.chainCell, styles.chainHeadText]}>Calls</Text>
              <Text style={[styles.strikeCell, styles.chainHeadText]}>Strike</Text>
              <Text style={[styles.chainCell, styles.chainHeadText]}>Puts</Text>
            </View>
            {ov.chain.map((r) => {
              const atm = r.strike === ov.atm_strike;
              return (
                <View key={r.strike} style={[styles.chainRow, atm && styles.atmRow]}>
                  <Text style={[styles.chainCell, r.strike < ov.spot && styles.itm]}>{r.call[metric] ?? "–"}</Text>
                  <Text style={[styles.strikeCell, atm && { color: OPT.color }]}>{r.strike}</Text>
                  <Text style={[styles.chainCell, r.strike > ov.spot && styles.itm]}>{r.put[metric] ?? "–"}</Text>
                </View>
              );
            })}
            <Text style={styles.small}>Shaded cells are in the money. {ov.data_source === "market" ? "Live bid/ask midpoints." : `Model values at ${ov.iv}% IV, r = ${(ov.risk_free_rate * 100).toFixed(1)}%.`}</Text>
          </SectionCard>

          <Text style={styles.disclaimer}>Options involve substantial risk and can lose their entire value quickly. Educational analysis, not investment advice.</Text>
        </>
      )}
    </ScrollView>
  );
}

function MoveBar({ spot, move }) {
  return (
    <View style={styles.moveBar}>
      <View style={styles.moveRange}>
        <Text style={styles.moveEdge}>${move.low}</Text>
        <View style={styles.moveTrack}>
          <View style={styles.moveFill} />
          <View style={styles.moveSpot} />
        </View>
        <Text style={styles.moveEdge}>${move.high}</Text>
      </View>
      <Text style={[styles.small, { textAlign: "center" }]}>Now ${spot}</Text>
    </View>
  );
}

function Tile({ label, value, color = colors.text, small }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, { color }, small && { fontSize: 12 }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const AiHeader = () => (
  <View style={styles.aiHeader}>
    <Ionicons name="sparkles" size={16} color={OPT.color} />
    <Text style={styles.aiTitle}>AI explanation</Text>
  </View>
);

const Tip = ({ text }) => (
  <View style={styles.tip}>
    <Ionicons name="school-outline" size={16} color={colors.primary} />
    <Text style={styles.tipText}>{text}</Text>
  </View>
);

function AiButton({ onPress, busy, label }) {
  return (
    <Pressable style={styles.aiButton} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator color={OPT.color} /> : <Ionicons name="sparkles" size={16} color={OPT.color} />}
      <Text style={styles.aiButtonText}>{busy ? "Thinking…" : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, alignSelf: "flex-start" },
  backText: { color: colors.primary, fontWeight: "700", fontSize: 16 },
  hero: { backgroundColor: colors.card, borderRadius: 22, padding: 18, marginTop: 8 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  muted: { color: colors.muted, marginTop: 2 },
  small: { color: colors.muted, fontSize: 12, marginTop: 6 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  subhead: { fontWeight: "800", color: colors.text, marginTop: 14, marginBottom: 6 },
  error: { color: colors.red, marginTop: 12 },
  loading: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 20 },
  chip: { borderWidth: 1.5, borderColor: OPT.soft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: OPT.color, borderColor: OPT.color },
  chipText: { color: OPT.color, fontWeight: "700", fontSize: 13 },
  banner: { flexDirection: "row", gap: 8, backgroundColor: colors.primarySoft, borderRadius: 14, padding: 12, marginTop: 14 },
  bannerText: { flex: 1, color: colors.primaryDark, fontSize: 12, lineHeight: 17 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, backgroundColor: colors.bg, borderRadius: 12, padding: 10 },
  tileLabel: { color: colors.muted, fontSize: 11 },
  tileValue: { fontSize: 16, fontWeight: "800", marginTop: 2 },
  warn: { flexDirection: "row", gap: 8, backgroundColor: colors.amberSoft, borderRadius: 12, padding: 10, marginTop: 12 },
  warnText: { flex: 1, color: "#92400E", fontSize: 13, lineHeight: 18 },
  moveBar: { marginTop: 4 },
  moveRange: { flexDirection: "row", alignItems: "center", gap: 8 },
  moveEdge: { color: colors.text, fontWeight: "700", fontSize: 12 },
  moveTrack: { flex: 1, height: 12, borderRadius: 6, backgroundColor: colors.border, justifyContent: "center" },
  moveFill: { position: "absolute", left: "16%", right: "16%", top: 0, bottom: 0, backgroundColor: OPT.soft, borderRadius: 6 },
  moveSpot: { position: "absolute", left: "50%", marginLeft: -2, width: 4, height: 18, borderRadius: 2, backgroundColor: OPT.color },
  levelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  levelLabel: { width: 150, color: colors.text, fontSize: 13 },
  probTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" },
  probFill: { height: 8, borderRadius: 4, backgroundColor: OPT.color },
  levelValue: { width: 46, textAlign: "right", fontWeight: "700", color: colors.text, fontSize: 13 },
  ai: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  aiHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  aiTitle: { fontWeight: "800", color: OPT.color },
  tip: { flexDirection: "row", gap: 8, backgroundColor: colors.primarySoft, borderRadius: 12, padding: 10, marginTop: 12 },
  tipText: { flex: 1, color: colors.primaryDark, fontSize: 13, lineHeight: 18 },
  aiButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, borderWidth: 1.5, borderColor: OPT.soft, borderRadius: 12, padding: 12 },
  aiButtonText: { color: OPT.color, fontWeight: "700" },
  strategyTitle: { fontWeight: "800", fontSize: 16, color: colors.text },
  legs: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 10 },
  metricRow: { flexDirection: "row", gap: 6, marginBottom: 10 },
  metric: { flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: "center", backgroundColor: colors.bg },
  metricActive: { backgroundColor: OPT.soft },
  metricText: { fontSize: 12, fontWeight: "700", color: colors.muted },
  chainHead: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  chainHeadText: { fontWeight: "800", color: colors.muted, fontSize: 12 },
  chainRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  atmRow: { backgroundColor: OPT.soft },
  chainCell: { flex: 1, textAlign: "center", fontSize: 13, color: colors.text },
  strikeCell: { width: 80, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 13 },
  itm: { backgroundColor: "#F1F5F9" },
  disclaimer: { color: colors.muted, fontSize: 11, marginTop: 20, textAlign: "center" },
});
