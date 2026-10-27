import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { colors } from "../theme";
import { PrimaryButton, SectionCard } from "../components/ui";
import LineChart from "../components/LineChart";

const BT = { color: "#EA580C", soft: "#FFEDD5", icon: "flask-outline" };
const PARAM_LABELS = { fast: "Fast", slow: "Slow", period: "Period", buy_below: "Buy below", sell_above: "Sell above", signal: "Signal", entry: "Entry high (days)", exit: "Exit low (days)" };
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" });

/** Strategy backtester: rules -> equity curve vs buy-and-hold, drawdowns, stats, trades. */
export default function BacktestScreen({ ticker, onBack }) {
  const [strategies, setStrategies] = useState([]);
  const [key, setKey] = useState("sma_cross");
  const [params, setParams] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.backtestStrategies().then((list) => {
      setStrategies(list);
      setParams(Object.fromEntries(Object.entries(list.find((s) => s.key === "sma_cross")?.params ?? {}).map(([k, v]) => [k, String(v)])));
    }).catch((e) => setError(e.message));
  }, []);

  function choose(k) {
    setKey(k);
    setResult(null);
    setParams(Object.fromEntries(Object.entries(strategies.find((s) => s.key === k)?.params ?? {}).map(([p, v]) => [p, String(v)])));
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.backtest(ticker, { strategy: key, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Number(v)])) }));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  useEffect(() => {
    if (strategies.length) run();
  }, [strategies.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = result?.stats, h = result?.buy_and_hold;
  const better = (a, b, higher = true) => (a == null || b == null ? colors.text : (higher ? a >= b : a <= b) ? colors.green : colors.red);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Pressable onPress={onBack} style={styles.back} hitSlop={10}>
        <Ionicons name="arrow-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <View style={styles.hero}>
        <Text style={styles.title}>Backtest {ticker}</Text>
        <Text style={styles.muted}>Test simple trading rules on ~2 years of daily prices. Trades fill at the next day's open with 5 bps costs.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 6 }}>
          {strategies.map((st) => (
            <Pressable key={st.key} onPress={() => choose(st.key)} style={[styles.chip, key === st.key && styles.chipActive]}>
              <Text style={[styles.chipText, key === st.key && { color: colors.white }]}>{st.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.params}>
          {Object.entries(params).map(([p, v]) => (
            <View key={p} style={styles.param}>
              <Text style={styles.paramLabel}>{PARAM_LABELS[p] ?? p}</Text>
              <TextInput style={styles.paramInput} value={v} onChangeText={(t) => setParams((x) => ({ ...x, [p]: t.replace(/[^0-9.]/g, "") }))} keyboardType="number-pad" />
            </View>
          ))}
        </View>
        <PrimaryButton title="Run backtest" icon="play" onPress={run} loading={busy} style={{ marginTop: 12 }} />
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      {busy && !result && <ActivityIndicator color={BT.color} style={{ marginTop: 20 }} />}

      {result && (
        <>
          <SectionCard title="Equity curve" section={BT}>
            <Text style={styles.rules}>{result.rules}</Text>
            <LineChart
              data={result.curve.map((p) => ({ x: p.t, strategy: p.strategy, hold: p.hold }))}
              series={[{ key: "strategy", label: "Strategy", color: BT.color, fill: true }, { key: "hold", label: "Buy & hold", color: colors.muted, dashed: true }]}
              format={(v) => `$${(v / 1000).toFixed(1)}k`}
              xLabel={(t) => new Date(t).toLocaleDateString()}
            />
            <Text style={styles.small}>$10,000 starting capital · {result.period.from} to {result.period.to}</Text>
          </SectionCard>

          <SectionCard title="Strategy vs buy & hold" section={{ ...BT, icon: "stats-chart-outline" }}>
            <View style={styles.tableHead}>
              <Text style={[styles.cellLabel, styles.headText]} />
              <Text style={[styles.cell, styles.headText, { color: BT.color }]}>Strategy</Text>
              <Text style={[styles.cell, styles.headText]}>Buy & hold</Text>
            </View>
            <Row label="Total return" a={`${s.total_return_pct}%`} b={`${h.total_return_pct}%`} color={better(s.total_return_pct, h.total_return_pct)} />
            <Row label="Annualized" a={s.cagr_pct != null ? `${s.cagr_pct}%` : "–"} b={h.cagr_pct != null ? `${h.cagr_pct}%` : "–"} color={better(s.cagr_pct, h.cagr_pct)} />
            <Row label="Max drawdown" a={`${s.max_drawdown_pct}%`} b={`${h.max_drawdown_pct}%`} color={better(s.max_drawdown_pct, h.max_drawdown_pct)} />
            <Row label="Sharpe ratio" a={s.sharpe ?? "–"} b={h.sharpe ?? "–"} color={better(s.sharpe, h.sharpe)} />
            <Row label="Volatility" a={`${s.volatility_pct}%`} b={`${h.volatility_pct}%`} color={better(s.volatility_pct, h.volatility_pct, false)} />
            <Row label="Time invested" a={`${s.exposure_pct}%`} b="100%" />
            <Row label="Trades" a={s.trades} b="1" />
            <Row label="Win rate" a={s.win_rate_pct != null ? `${s.win_rate_pct}%` : "–"} b="–" />
          </SectionCard>

          <SectionCard title="Drawdowns" section={{ ...BT, icon: "trending-down-outline" }}>
            <LineChart
              data={result.curve.map((p) => ({ x: p.t, dd: p.dd, dd_hold: p.dd_hold }))}
              series={[{ key: "dd", label: "Strategy", color: colors.red, fill: true }, { key: "dd_hold", label: "Buy & hold", color: colors.muted, dashed: true }]}
              format={(v) => `${v.toFixed(0)}%`}
              height={140}
              xLabel={(t) => new Date(t).toLocaleDateString()}
              zero
            />
            <Text style={styles.small}>How far each approach fell from its previous peak.</Text>
          </SectionCard>

          <SectionCard title={`Trades (${result.trades.length})`} section={{ ...BT, icon: "swap-horizontal-outline" }}>
            {result.trades.length === 0 && <Text style={styles.muted}>No trades were triggered in this period.</Text>}
            {[...result.trades].reverse().slice(0, 20).map((t, i) => (
              <View key={i} style={styles.trade}>
                <Text style={styles.tradeDates}>{fmtDate(t.entry_date)} → {t.exit_date ? fmtDate(t.exit_date) : "open"}</Text>
                <Text style={styles.small}>${t.entry_price} → {t.exit_price ? `$${t.exit_price}` : "now"}</Text>
                <Text style={[styles.tradeRet, { color: (t.return_pct ?? 0) >= 0 ? colors.green : colors.red }]}>{t.return_pct >= 0 ? "+" : ""}{t.return_pct}%</Text>
              </View>
            ))}
          </SectionCard>

          <Text style={styles.disclaimer}>Past performance doesn't predict future results. Backtests ignore taxes, slippage beyond the cost assumption, and dividends. Educational only.</Text>
        </>
      )}
    </ScrollView>
  );
}

function Row({ label, a, b, color = colors.text }) {
  return (
    <View style={styles.row}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={[styles.cell, { color, fontWeight: "800" }]}>{a}</Text>
      <Text style={styles.cell}>{b}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, alignSelf: "flex-start" },
  backText: { color: colors.primary, fontWeight: "700", fontSize: 16 },
  hero: { backgroundColor: colors.card, borderRadius: 22, padding: 18, marginTop: 8 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  muted: { color: colors.muted, marginTop: 4, lineHeight: 19 },
  small: { color: colors.muted, fontSize: 12, marginTop: 6 },
  error: { color: colors.red, marginTop: 10 },
  chip: { borderWidth: 1.5, borderColor: BT.soft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: BT.color, borderColor: BT.color },
  chipText: { color: BT.color, fontWeight: "700", fontSize: 13 },
  params: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  param: { minWidth: "30%", flex: 1 },
  paramLabel: { color: colors.muted, fontSize: 11, marginBottom: 4 },
  paramInput: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, fontWeight: "700", color: colors.text },
  rules: { color: colors.text, fontSize: 13, marginBottom: 10, lineHeight: 19 },
  tableHead: { flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  headText: { fontWeight: "800", color: colors.muted, fontSize: 12 },
  row: { flexDirection: "row", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
  cellLabel: { flex: 1.3, color: colors.text, fontSize: 13 },
  cell: { flex: 1, textAlign: "right", color: colors.text, fontSize: 13 },
  trade: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
  tradeDates: { flex: 1, color: colors.text, fontWeight: "600", fontSize: 13 },
  tradeRet: { width: 64, textAlign: "right", fontWeight: "800" },
  disclaimer: { color: colors.muted, fontSize: 11, marginTop: 20, textAlign: "center" },
});
