import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Banner, Input, PageHeader, Pill, TickerAvatar } from "../components/ui";

const EXAMPLES = [
  "Oversold large caps above their 200-day average",
  "Profitable tech stocks with P/E under 25",
  "High dividend stocks near their 52-week high",
  "Fast-growing companies in an uptrend",
  "Beaten-down stocks with RSI under 35",
];
const FIELD_LABELS = { pe: "P/E", rsi14: "RSI", dividend_yield: "Yield %", market_cap_b: "Cap $B", change_1m: "1M %", change_1y: "1Y %", revenue_growth: "Rev growth %", pct_from_52w_high: "From high %", price: "Price", eps_growth: "EPS growth %", net_margin: "Net margin %", beta: "Beta", change_1d: "1D %", change_1w: "1W %", change_3m: "3M %", pct_above_sma200: "vs 200d %", volume_ratio: "Vol ×", atr_pct: "ATR %" };

/** Natural-language stock screener. */
export default function ScreenerScreen({ onOpenStock }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const sec = sections.screener;
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run(text = query) {
    const q = text.trim();
    if (!q) return setError("Describe the stocks you're looking for.");
    setQuery(q);
    setBusy(true);
    setError(null);
    try {
      setResult(await api.screen(q));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  // Columns: the fields the user filtered or sorted on, then a couple of defaults
  const shown = result ? [...new Set([...(result.filters?.numeric_filters ?? []).map((f) => f.field), result.filters?.sort_by, "rsi14", "change_1m"].filter(Boolean))].slice(0, 3) : [];
  const f = result?.filters;

  const header = (
    <View>
      <PageHeader eyebrow="Screener" title="Describe it. AI finds it." subtitle="Plain-English screens over about 100 large US stocks, with a note on every match." />
      <View style={s.searchCard}>
        <Input
          icon="funnel-outline"
          placeholder="e.g. cheap profitable stocks in an uptrend"
          value={query}
          onChangeText={(t) => { setQuery(t); setError(null); }}
          onSubmitEditing={() => run()}
          returnKeyType="search"
          right={
            <Pressable style={[s.go, busy && { opacity: 0.5 }]} onPress={() => run()} disabled={busy} accessibilityLabel="Run screen">
              {busy ? <ActivityIndicator color={c.onPrimary} size="small" /> : <Ionicons name="arrow-forward" size={18} color={c.onPrimary} />}
            </Pressable>
          }
          style={{ paddingRight: 5 }}
        />
        {error && <Banner tone="error">{error}</Banner>}
        {!result && (
          <View style={s.examples}>
            <Text style={s.label}>Try one of these</Text>
            {EXAMPLES.map((e) => (
              <Pressable key={e} style={({ hovered }) => [s.example, hovered && { backgroundColor: sec.soft }]} onPress={() => run(e)} disabled={busy}>
                <Ionicons name="sparkles-outline" size={15} color={sec.color} />
                <Text style={s.exampleText}>{e}</Text>
                <Ionicons name="arrow-forward" size={15} color={c.muted} />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {result && (
        <View style={s.summary}>
          <Text style={s.interpretation}>{f?.interpretation}</Text>
          <View style={s.filterChips}>
            {(f?.numeric_filters ?? []).map((x, i) => <Pill key={i} text={`${FIELD_LABELS[x.field] ?? x.field} ${x.op === "gt" ? ">" : "<"} ${x.value}`} color={c.primary} />)}
            {f?.sectors?.map((x) => <Pill key={x} text={x} color={c.hue("teal")} />)}
            {f?.trend !== "any" && <Pill text={f?.trend} color={c.hue("sky")} />}
            {f?.technical_rating !== "any" && <Pill text={`${f?.technical_rating} rating`} color={c.hue("violet")} />}
            {f?.above_sma200 !== "any" && <Pill text={`${f?.above_sma200 === "yes" ? "above" : "below"} 200-day`} color={c.hue("amber")} />}
          </View>
          {result.summary ? <Text style={s.summaryText}>{result.summary}</Text> : null}
          <Text style={s.meta}>{result.results.length} matches · data for {result.coverage} stocks{result.data_as_of ? ` · as of ${new Date(result.data_as_of).toLocaleDateString()}` : ""}</Text>
        </View>
      )}
    </View>
  );

  return (
    <FlatList
      data={result?.results ?? []}
      keyExtractor={(r) => r.ticker}
      ListHeaderComponent={header}
      contentContainerStyle={s.list}
      renderItem={({ item }) => (
        <Pressable style={({ pressed, hovered }) => [s.row, hovered && { borderColor: c.borderStrong }, pressed && { opacity: 0.85 }]} onPress={() => onOpenStock(item.ticker)}>
          <View style={s.rowTop}>
            <TickerAvatar ticker={item.ticker} size={42} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={s.rowSub}>{item.ticker} · {item.sector} · ${item.price}</Text>
            </View>
            {item.change_1d != null && (
              <Text style={[s.rowChange, { color: item.change_1d >= 0 ? c.gain : c.loss }]}>{item.change_1d >= 0 ? "+" : ""}{item.change_1d}%</Text>
            )}
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </View>
          <View style={s.metrics}>
            {shown.map((k) => (
              <View key={k} style={s.metric}>
                <Text style={s.metricLabel}>{FIELD_LABELS[k] ?? k}</Text>
                <Text style={s.metricValue}>{item[k] ?? "–"}</Text>
              </View>
            ))}
          </View>
          {item.note && <Text style={s.note}>{item.note}</Text>}
        </Pressable>
      )}
      ListEmptyComponent={result && !busy ? <Text style={s.meta}>No matches. Try loosening a condition.</Text> : null}
    />
  );
}

const useStyles = makeStyles((c) => ({
  list: { padding: 16, paddingBottom: 40 },
  searchCard: { backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 14 },
  go: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
  label: { color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6, marginTop: 4 },
  examples: { marginTop: 14, gap: 4 },
  example: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 11 },
  exampleText: { color: c.text, fontWeight: "500", flex: 1, fontSize: 14 },
  summary: { marginTop: 18, marginBottom: 4 },
  interpretation: { fontWeight: "800", color: c.text, fontSize: 17, letterSpacing: -0.2 },
  filterChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  summaryText: { color: c.textSecondary, marginTop: 12, lineHeight: 21, fontSize: 14 },
  meta: { color: c.muted, fontSize: 12, marginTop: 10 },
  row: { backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 14, marginTop: 10 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowTitle: { fontWeight: "700", color: c.text, fontSize: 15 },
  rowSub: { color: c.muted, fontSize: 12, marginTop: 2 },
  rowChange: { fontWeight: "800", fontSize: 13, fontVariant: ["tabular-nums"] },
  metrics: { flexDirection: "row", gap: 8, marginTop: 12 },
  metric: { flex: 1, backgroundColor: c.surfaceAlt, borderRadius: 12, padding: 10 },
  metricLabel: { color: c.muted, fontSize: 11 },
  metricValue: { color: c.text, fontWeight: "800", fontSize: 15, marginTop: 2, fontVariant: ["tabular-nums"] },
  note: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 12 },
}));
