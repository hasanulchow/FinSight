import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { BackButton, Banner, Button, Chip, Disclaimer, Loading, SectionCard, Stat } from "../components/ui";
import LineChart from "../components/LineChart";

const PARAM_LABELS = { fast: "Fast", slow: "Slow", period: "Period", buy_below: "Buy below", sell_above: "Sell above", signal: "Signal", entry: "Entry high (days)", exit: "Exit low (days)" };
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" });

/** Strategy backtester: rules -> equity curve vs buy-and-hold, drawdowns, stats, trades. */
export default function BacktestScreen({ ticker, onBack }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const sec = sections.backtest;
  const [strategies, setStrategies] = useState([]);
  const [key, setKey] = useState("sma_cross");
  const [params, setParams] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.backtestStrategies().then((list) => {
      setStrategies(list);
      setParams(Object.fromEntries(Object.entries(list.find((x) => x.key === "sma_cross")?.params ?? {}).map(([k, v]) => [k, String(v)])));
    }).catch((e) => setError(e.message));
  }, []);

  function choose(k) {
    setKey(k);
    setResult(null);
    setParams(Object.fromEntries(Object.entries(strategies.find((x) => x.key === k)?.params ?? {}).map(([p, v]) => [p, String(v)])));
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

  const st = result?.stats, h = result?.buy_and_hold;
  const better = (a, b, higher = true) => (a == null || b == null ? c.text : (higher ? a >= b : a <= b) ? c.gain : c.loss);
  const beat = st && h ? st.total_return_pct >= h.total_return_pct : null;

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <BackButton onPress={onBack} />

      <View style={s.hero}>
        <View style={s.heroTop}>
          <View style={[s.heroIcon, { backgroundColor: sec.soft }]}><Ionicons name="flask" size={22} color={sec.color} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Backtest {ticker}</Text>
            <Text style={s.muted}>~2 years of daily prices · next-day open fills · 5 bps costs</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }} contentContainerStyle={{ gap: 6 }}>
          {strategies.map((x) => <Chip key={x.key} label={x.label} active={key === x.key} onPress={() => choose(x.key)} color={sec.color} />)}
        </ScrollView>
        <View style={s.params}>
          {Object.entries(params).map(([p, v]) => (
            <View key={p} style={s.param}>
              <Text style={s.paramLabel}>{PARAM_LABELS[p] ?? p}</Text>
              <TextInput style={s.paramInput} value={v} onChangeText={(t) => setParams((x) => ({ ...x, [p]: t.replace(/[^0-9.]/g, "") }))} keyboardType="number-pad" />
            </View>
          ))}
        </View>
        <Button title="Run backtest" icon="play" onPress={run} loading={busy} size="lg" style={{ marginTop: 14 }} />
        {error && <Banner tone="error">{error}</Banner>}
      </View>

      {busy && !result && <Loading text="Running the backtest…" />}

      {result && (
        <>
          <SectionCard title="Equity curve" subtitle={`$10,000 · ${result.period.from} to ${result.period.to}`} section={sec}>
            <Text style={s.rules}>{result.rules}</Text>
            <View style={[s.verdict, { backgroundColor: c.soft(beat ? c.gain : c.loss) }]}>
              <Ionicons name={beat ? "trophy-outline" : "trending-down-outline"} size={16} color={beat ? c.gain : c.loss} />
              <Text style={[s.verdictText, { color: c.text }]}>
                Strategy {st.total_return_pct >= 0 ? "+" : ""}{st.total_return_pct}% vs buy & hold {h.total_return_pct >= 0 ? "+" : ""}{h.total_return_pct}% · max drawdown {st.max_drawdown_pct}% vs {h.max_drawdown_pct}%
              </Text>
            </View>
            <LineChart
              data={result.curve.map((p) => ({ x: p.t, strategy: p.strategy, hold: p.hold }))}
              series={[{ key: "strategy", label: "Strategy", color: sec.color, fill: true }, { key: "hold", label: "Buy & hold", color: c.muted, dashed: true }]}
              format={(v) => `$${(v / 1000).toFixed(1)}k`}
              xLabel={(t) => new Date(t).toLocaleDateString()}
              height={220}
            />
          </SectionCard>

          <SectionCard title="Strategy vs buy & hold" section={{ ...sec, icon: "stats-chart-outline" }}>
            <View style={s.tableHead}>
              <Text style={[s.cellLabel, s.headText]} />
              <Text style={[s.cell, s.headText, { color: sec.color }]}>Strategy</Text>
              <Text style={[s.cell, s.headText]}>Buy & hold</Text>
            </View>
            <Row label="Total return" a={`${st.total_return_pct}%`} b={`${h.total_return_pct}%`} color={better(st.total_return_pct, h.total_return_pct)} />
            <Row label="Annualized" a={st.cagr_pct != null ? `${st.cagr_pct}%` : "–"} b={h.cagr_pct != null ? `${h.cagr_pct}%` : "–"} color={better(st.cagr_pct, h.cagr_pct)} />
            <Row label="Max drawdown" a={`${st.max_drawdown_pct}%`} b={`${h.max_drawdown_pct}%`} color={better(st.max_drawdown_pct, h.max_drawdown_pct)} />
            <Row label="Sharpe ratio" a={st.sharpe ?? "–"} b={h.sharpe ?? "–"} color={better(st.sharpe, h.sharpe)} />
            <Row label="Volatility" a={`${st.volatility_pct}%`} b={`${h.volatility_pct}%`} color={better(st.volatility_pct, h.volatility_pct, false)} />
            <Row label="Time invested" a={`${st.exposure_pct}%`} b="100%" />
            <Row label="Trades" a={st.trades} b="1" />
            <Row label="Win rate" a={st.win_rate_pct != null ? `${st.win_rate_pct}%` : "–"} b="–" last />
          </SectionCard>

          <SectionCard title="Drawdowns" subtitle="How far each fell from its previous peak" section={{ ...sec, icon: "trending-down-outline" }}>
            <LineChart
              data={result.curve.map((p) => ({ x: p.t, dd: p.dd, dd_hold: p.dd_hold }))}
              series={[{ key: "dd", label: "Strategy", color: c.loss, fill: true }, { key: "dd_hold", label: "Buy & hold", color: c.muted, dashed: true }]}
              format={(v) => `${v.toFixed(0)}%`}
              height={150}
              xLabel={(t) => new Date(t).toLocaleDateString()}
              zero
            />
          </SectionCard>

          <SectionCard title={`Trades · ${result.trades.length}`} section={{ ...sec, icon: "swap-horizontal-outline" }}>
            {result.trades.length === 0 && <Text style={s.muted}>No trades were triggered in this period.</Text>}
            <View style={s.statsRow}>
              {st.avg_trade_pct != null && <Stat label="Avg trade" value={`${st.avg_trade_pct}%`} color={st.avg_trade_pct >= 0 ? c.gain : c.loss} />}
              {st.win_rate_pct != null && <Stat label="Win rate" value={`${st.win_rate_pct}%`} />}
            </View>
            {[...result.trades].reverse().slice(0, 20).map((t, i) => (
              <View key={i} style={s.trade}>
                <View style={[s.tradeDot, { backgroundColor: (t.return_pct ?? 0) >= 0 ? c.gain : c.loss }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.tradeDates}>{fmtDate(t.entry_date)} → {t.exit_date ? fmtDate(t.exit_date) : "open"}</Text>
                  <Text style={s.small}>${t.entry_price} → {t.exit_price ? `$${t.exit_price}` : "now"}</Text>
                </View>
                <Text style={[s.tradeRet, { color: (t.return_pct ?? 0) >= 0 ? c.gain : c.loss }]}>{t.return_pct >= 0 ? "+" : ""}{t.return_pct}%</Text>
              </View>
            ))}
          </SectionCard>

          <Disclaimer>Past performance doesn't predict future results. Backtests ignore taxes, dividends and slippage beyond the cost assumption. Educational only.</Disclaimer>
        </>
      )}
    </ScrollView>
  );
}

function Row({ label, a, b, color, last }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={[s.row, last && { borderBottomWidth: 0 }]}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={[s.cell, { color: color ?? c.text, fontWeight: "800" }]}>{a}</Text>
      <Text style={[s.cell, { color: c.textSecondary }]}>{b}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  hero: { backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 20, marginTop: 8 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  heroIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", color: c.text, letterSpacing: -0.4 },
  muted: { color: c.textSecondary, marginTop: 2, fontSize: 13 },
  small: { color: c.muted, fontSize: 12, marginTop: 2 },
  params: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  param: { minWidth: "30%", flex: 1 },
  paramLabel: { color: c.muted, fontSize: 11, marginBottom: 5, fontWeight: "600" },
  paramInput: { borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, fontWeight: "700", color: c.text, outlineStyle: "none" },
  rules: { color: c.textSecondary, fontSize: 13, marginBottom: 10, lineHeight: 19 },
  verdict: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, padding: 10, marginBottom: 12 },
  verdictText: { flex: 1, fontSize: 13, fontWeight: "600" },
  tableHead: { flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  headText: { fontWeight: "700", color: c.muted, fontSize: 12 },
  row: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  cellLabel: { flex: 1.3, color: c.text, fontSize: 14 },
  cell: { flex: 1, textAlign: "right", color: c.text, fontSize: 14, fontVariant: ["tabular-nums"] },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  trade: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  tradeDot: { width: 8, height: 8, borderRadius: 4 },
  tradeDates: { color: c.text, fontWeight: "600", fontSize: 14 },
  tradeRet: { width: 72, textAlign: "right", fontWeight: "800", fontVariant: ["tabular-nums"] },
}));
