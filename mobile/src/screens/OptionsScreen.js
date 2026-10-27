import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { BackButton, Banner, Bullets, Chip, Disclaimer, Loading, Pill, SectionCard, Segmented, Stat } from "../components/ui";
import PayoffChart from "../components/PayoffChart";

const STRATS = [
  ["long_call", "Long call"], ["long_put", "Long put"], ["covered_call", "Covered call"], ["cash_secured_put", "Cash-secured put"],
  ["protective_put", "Protective put"], ["bull_call_spread", "Bull call spread"], ["bear_put_spread", "Bear put spread"],
  ["long_straddle", "Straddle"], ["long_strangle", "Strangle"], ["iron_condor", "Iron condor"],
];
const METRICS = [["price", "Price"], ["delta", "Delta"], ["prob_itm", "Prob. ITM"], ["iv", "IV"]];
const money = (v) => (v == null ? "Unlimited" : `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString()}`);

/** Options center: volatility & expected move, strategy builder with payoff chart, option chain. */
export default function OptionsScreen({ ticker, onBack }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const sec = sections.options;
  const [ov, setOv] = useState(null);
  const [error, setError] = useState(null);
  const [expiration, setExpiration] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [strategyKey, setStrategyKey] = useState("long_call");
  const [strategy, setStrategy] = useState(null);
  const [stratBusy, setStratBusy] = useState(false);
  const [metric, setMetric] = useState("price");
  const REGIME = { low: c.gain, normal: c.primary, elevated: c.warn, high: c.loss };

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
      setOv(await api.options(ticker, { expiration: ov.expiration, explain: true }));
    } catch (e) {
      setError(e.message);
    }
    setAiBusy(false);
  }

  const earningsBefore = ov?.next_earnings && ov.next_earnings.date <= ov.expiration;
  const regime = ov?.iv_vs_hv == null ? null : ov.iv_vs_hv < 0.8 ? "low" : ov.iv_vs_hv < 1.2 ? "normal" : ov.iv_vs_hv < 1.6 ? "elevated" : "high";
  const a = strategy?.analysis;
  const fmtMetric = (v) => (v == null ? "–" : metric === "prob_itm" || metric === "iv" ? `${v}%` : v);

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <BackButton onPress={onBack} />

      <View style={s.hero}>
        <View style={s.heroTop}>
          <View style={[s.heroIcon, { backgroundColor: sec.soft }]}><Ionicons name="options" size={22} color={sec.color} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{ticker} options</Text>
            <Text style={s.muted}>{ov ? `Spot $${ov.spot} · ${ov.dte} days to ${ov.expiration}` : "Volatility, expected move and strategies"}</Text>
          </View>
          {ov && <Pill text={ov.data_source === "market" ? "Live chain" : "Model"} color={ov.data_source === "market" ? c.gain : c.warn} />}
        </View>
        {ov?.expirations && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }} contentContainerStyle={{ gap: 6 }}>
            {ov.expirations.map((e) => (
              <Chip key={e} label={new Date(`${e}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} active={e === ov.expiration} onPress={() => setExpiration(e)} color={sec.color} />
            ))}
          </ScrollView>
        )}
      </View>

      {!ov && !error && <Loading text="Loading options data… the first load can take up to a minute on the free data plan." />}
      {error && <Banner tone="error">{error}</Banner>}

      {ov && (
        <>
          {ov.data_source === "model" && (
            <Banner tone="info">Strike prices and greeks are Black-Scholes estimates at the {ov.iv}% implied volatility from at-the-money option prices. A paid options data plan shows the live chain.</Banner>
          )}

          <SectionCard title="Volatility & expected move" section={sec} right={regime ? <Pill text={`IV ${regime}`} color={REGIME[regime]} /> : null}>
            <View style={s.stats}>
              <Stat label="Implied vol" value={`${ov.iv}%`} color={sec.color} />
              <Stat label="Hist. vol 20d" value={ov.hv20 != null ? `${ov.hv20}%` : "–"} />
              <Stat label="IV / HV" value={ov.iv_vs_hv ?? "–"} color={regime ? REGIME[regime] : c.text} />
            </View>
            {earningsBefore && <Banner tone="warn" icon="calendar">Earnings on {ov.next_earnings.date} fall before this expiration. Implied volatility usually drops sharply after the report.</Banner>}

            <Text style={s.subhead}>Expected move by {ov.expiration}</Text>
            <View style={s.moveRange}>
              <View style={s.moveEnd}><Text style={s.moveLabel}>Low</Text><Text style={[s.moveValue, { color: c.loss }]}>${ov.expected_move.low}</Text></View>
              <View style={s.moveTrack}>
                <View style={[s.moveFill, { backgroundColor: sec.soft }]} />
                <View style={[s.moveSpot, { backgroundColor: sec.color }]} />
              </View>
              <View style={[s.moveEnd, { alignItems: "flex-end" }]}><Text style={s.moveLabel}>High</Text><Text style={[s.moveValue, { color: c.gain }]}>${ov.expected_move.high}</Text></View>
            </View>
            <Text style={s.small}>±${ov.expected_move.move} ({ov.expected_move.pct}%) · about 68% of outcomes land in this range{ov.straddle_price ? ` · ATM straddle $${ov.straddle_price}` : ""}</Text>

            <Text style={s.subhead}>Chance of finishing above…</Text>
            {ov.levels.map((l) => (
              <View key={`${l.label}${l.level}`} style={s.levelRow}>
                <Text style={s.levelLabel}>${l.level} <Text style={s.small}>{l.label}</Text></Text>
                <View style={s.probTrack}><View style={[s.probFill, { width: `${l.prob_above}%`, backgroundColor: sec.color }]} /></View>
                <Text style={s.levelValue}>{l.prob_above}%</Text>
              </View>
            ))}
            {ov.flow && (
              <View style={[s.stats, { marginTop: 14 }]}>
                <Stat label="Put/call vol" value={ov.flow.put_call_volume_ratio ?? "–"} />
                <Stat label="Put/call OI" value={ov.flow.put_call_oi_ratio ?? "–"} />
                <Stat label="Max pain" value={ov.flow.max_pain ? `$${ov.flow.max_pain}` : "–"} />
              </View>
            )}
            {ov.ai ? (
              <View style={s.ai}>
                <AiHeader color={sec.color} />
                <Text style={s.body}>{ov.ai.volatility_read}</Text>
                <Text style={[s.body, { marginTop: 8 }]}>{ov.ai.expected_move_read}</Text>
                <Text style={s.subhead}>Key risks</Text>
                <Bullets items={ov.ai.key_risks} color={sec.color} />
                <View style={s.tip}><Ionicons name="school-outline" size={16} color={c.primary} /><Text style={s.tipText}>{ov.ai.education_tip}</Text></View>
              </View>
            ) : (
              <AiButton onPress={explainVol} busy={aiBusy} label="Explain the volatility picture" color={sec.color} />
            )}
          </SectionCard>

          <SectionCard title="Strategy builder" subtitle="Built around today's price · per 1 contract" section={{ ...sec, icon: "construct-outline" }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {STRATS.map(([key, label]) => <Chip key={key} label={label} active={strategyKey === key} onPress={() => setStrategyKey(key)} color={sec.color} />)}
            </ScrollView>
            {stratBusy && !strategy && <Loading />}
            {strategy && a && (
              <View style={{ marginTop: 16, opacity: stratBusy ? 0.5 : 1 }}>
                <View style={s.stratHead}>
                  <Text style={s.strategyTitle}>{strategy.label}</Text>
                  <Pill text={strategy.view} color={c.textSecondary} />
                </View>
                <View style={s.legs}>
                  {strategy.legs.map((l, i) => (
                    <View key={i} style={[s.leg, { borderColor: c.soft(l.side === "long" ? c.gain : c.loss) }]}>
                      <Text style={[s.legSide, { color: l.side === "long" ? c.gain : c.loss }]}>{l.side === "long" ? "BUY" : "SELL"}</Text>
                      <Text style={s.legText}>{l.kind === "stock" ? "100 shares" : `${l.strike} ${l.kind}`}</Text>
                      <Text style={s.legPrice}>${l.premium}</Text>
                    </View>
                  ))}
                </View>
                <PayoffChart curve={a.curve} spot={strategy.spot} breakevens={a.breakevens} expectedMove={ov.expected_move} />
                <View style={[s.stats, { marginTop: 14 }]}>
                  <Stat label="Max profit" value={money(a.max_profit)} color={c.gain} />
                  <Stat label="Max loss" value={a.unbounded_loss ? "Unlimited" : money(a.max_loss)} color={c.loss} />
                  <Stat label="Prob. of profit" value={`${a.probability_of_profit}%`} color={sec.color} />
                </View>
                <View style={[s.stats, { marginTop: 8 }]}>
                  <Stat label={a.net_premium >= 0 ? "Net credit" : "Net debit"} value={`$${Math.abs(a.net_premium).toLocaleString()}`} />
                  <Stat label="Breakeven" value={a.breakevens.length ? a.breakevens.map((x) => `$${x}`).join(" / ") : "–"} />
                  <Stat label="Theta / day" value={`${a.position_greeks.theta_per_day < 0 ? "-" : "+"}$${Math.abs(a.position_greeks.theta_per_day).toFixed(2)}`} color={a.position_greeks.theta_per_day >= 0 ? c.gain : c.loss} />
                </View>
                <Text style={s.small}>Delta {a.position_greeks.delta} · gamma {a.position_greeks.gamma} · vega ${a.position_greeks.vega_per_1pct} per 1% IV</Text>
                {strategy.ai ? (
                  <View style={s.ai}>
                    <AiHeader color={sec.color} />
                    <Text style={s.body}>{strategy.ai.strategy_explanation}</Text>
                    <Text style={s.subhead}>Key risks</Text>
                    <Bullets items={strategy.ai.key_risks} color={sec.color} />
                  </View>
                ) : (
                  <AiButton onPress={() => loadStrategy(strategyKey, true)} busy={stratBusy} label="Explain this strategy" color={sec.color} />
                )}
              </View>
            )}
          </SectionCard>

          <SectionCard title="Option chain" subtitle={ov.data_source === "market" ? "Live bid/ask midpoints" : `Model values at ${ov.iv}% IV`} section={{ ...sec, icon: "list-outline" }}>
            <Segmented options={METRICS} value={metric} onChange={setMetric} />
            <View style={s.chainHead}>
              <Text style={[s.cell, s.headText, { color: c.gain }]}>Calls</Text>
              <Text style={[s.strike, s.headText]}>Strike</Text>
              <Text style={[s.cell, s.headText, { color: c.loss }]}>Puts</Text>
            </View>
            {ov.chain.map((r) => {
              const atm = r.strike === ov.atm_strike;
              return (
                <View key={r.strike} style={[s.chainRow, atm && { backgroundColor: sec.soft }]}>
                  <Text style={[s.cell, r.strike < ov.spot && s.itm]}>{fmtMetric(r.call[metric])}</Text>
                  <Text style={[s.strike, atm && { color: sec.color }]}>{r.strike}{atm ? " •" : ""}</Text>
                  <Text style={[s.cell, r.strike > ov.spot && s.itm]}>{fmtMetric(r.put[metric])}</Text>
                </View>
              );
            })}
            <Text style={s.small}>Shaded cells are in the money · • marks the at-the-money strike · r = {(ov.risk_free_rate * 100).toFixed(1)}%</Text>
          </SectionCard>

          <Disclaimer>Options involve substantial risk and can lose their entire value quickly. Educational analysis, not investment advice.</Disclaimer>
        </>
      )}
    </ScrollView>
  );
}

function AiHeader({ color }) {
  const s = useStyles();
  return (
    <View style={s.aiHeader}>
      <Ionicons name="sparkles" size={15} color={color} />
      <Text style={[s.aiTitle, { color }]}>AI explanation</Text>
    </View>
  );
}

function AiButton({ onPress, busy, label, color }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <Pressable style={({ hovered }) => [s.aiButton, { borderColor: c.soft(color) }, hovered && { backgroundColor: c.soft(color) }]} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator color={color} /> : <Ionicons name="sparkles" size={16} color={color} />}
      <Text style={[s.aiButtonText, { color }]}>{busy ? "Thinking…" : label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  hero: { backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 20, marginTop: 8 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  heroIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", color: c.text, letterSpacing: -0.4 },
  muted: { color: c.textSecondary, marginTop: 2, fontSize: 14 },
  small: { color: c.muted, fontSize: 12, marginTop: 8 },
  body: { color: c.text, fontSize: 14, lineHeight: 21 },
  subhead: { fontWeight: "700", color: c.text, marginTop: 18, marginBottom: 8, fontSize: 14 },
  stats: { flexDirection: "row", gap: 8 },
  moveRange: { flexDirection: "row", alignItems: "center", gap: 12 },
  moveEnd: { width: 70 },
  moveLabel: { color: c.muted, fontSize: 11 },
  moveValue: { fontWeight: "800", fontSize: 15, fontVariant: ["tabular-nums"] },
  moveTrack: { flex: 1, height: 12, borderRadius: 6, backgroundColor: c.surfaceAlt, justifyContent: "center" },
  moveFill: { position: "absolute", left: "16%", right: "16%", top: 0, bottom: 0, borderRadius: 6 },
  moveSpot: { position: "absolute", left: "50%", marginLeft: -2, width: 4, height: 20, borderRadius: 2 },
  levelRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  levelLabel: { width: 156, color: c.text, fontSize: 13, fontVariant: ["tabular-nums"] },
  probTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: "hidden" },
  probFill: { height: 8, borderRadius: 4 },
  levelValue: { width: 50, textAlign: "right", fontWeight: "700", color: c.text, fontSize: 13, fontVariant: ["tabular-nums"] },
  ai: { marginTop: 16, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 14 },
  aiHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  aiTitle: { fontWeight: "800", fontSize: 13 },
  tip: { flexDirection: "row", gap: 8, backgroundColor: c.primarySoft, borderRadius: 12, padding: 12, marginTop: 14 },
  tipText: { flex: 1, color: c.text, fontSize: 13, lineHeight: 19 },
  aiButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16, borderWidth: 1, borderRadius: 14, padding: 13 },
  aiButtonText: { fontWeight: "700" },
  stratHead: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  strategyTitle: { fontWeight: "800", fontSize: 18, color: c.text },
  legs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 14 },
  leg: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: c.surfaceAlt },
  legSide: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  legText: { color: c.text, fontWeight: "700", fontSize: 13 },
  legPrice: { color: c.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  chainHead: { flexDirection: "row", paddingVertical: 8, marginTop: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  headText: { fontWeight: "700", fontSize: 12, color: c.muted },
  chainRow: { flexDirection: "row", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: c.border },
  cell: { flex: 1, textAlign: "center", fontSize: 13, color: c.text, fontVariant: ["tabular-nums"] },
  strike: { width: 88, textAlign: "center", fontWeight: "800", color: c.text, fontSize: 13, fontVariant: ["tabular-nums"] },
  itm: { backgroundColor: c.surfaceAlt },
}));
