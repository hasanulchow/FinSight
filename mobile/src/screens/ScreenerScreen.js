import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { colors } from "../theme";
import { Pill, TickerAvatar } from "../components/ui";

const EXAMPLES = [
  "Oversold large caps above their 200-day average",
  "Profitable tech stocks with P/E under 25",
  "High dividend stocks near their 52-week high",
  "Fast-growing companies in an uptrend",
  "Beaten-down stocks with RSI under 35",
];
const FIELD_LABELS = { pe: "P/E", rsi14: "RSI", dividend_yield: "Yield %", market_cap_b: "Cap $B", change_1m: "1M %", change_1y: "1Y %", revenue_growth: "Rev growth %", pct_from_52w_high: "From high %", price: "Price", eps_growth: "EPS growth %", net_margin: "Net margin %", beta: "Beta", change_1d: "1D %", change_1w: "1W %", change_3m: "3M %", pct_above_sma200: "vs 200d %", volume_ratio: "Vol x", atr_pct: "ATR %" };

/** Natural-language stock screener. */
export default function ScreenerScreen({ onOpenStock }) {
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

  // Columns to show: the fields the user filtered/sorted on, then a couple of defaults
  const shown = result
    ? [...new Set([...(result.filters?.numeric_filters ?? []).map((f) => f.field), result.filters?.sort_by, "rsi14", "change_1m"].filter(Boolean))].slice(0, 3)
    : [];

  const header = (
    <View>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Screener</Text>
        <Text style={styles.heroSub}>Describe what you want in plain English. AI turns it into filters over {result?.coverage?.split("/")[1] ?? "100"} large US stocks.</Text>
      </View>
      <View style={styles.searchCard}>
        <View style={styles.inputRow}>
          <Ionicons name="funnel-outline" size={20} color={colors.primary} />
          <TextInput
            style={styles.input}
            placeholder="e.g. cheap profitable stocks in an uptrend"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={(t) => { setQuery(t); setError(null); }}
            onSubmitEditing={() => run()}
            returnKeyType="search"
            multiline={false}
          />
          <Pressable style={[styles.go, busy && { opacity: 0.5 }]} onPress={() => run()} disabled={busy} accessibilityLabel="Run screen">
            {busy ? <ActivityIndicator color={colors.white} size="small" /> : <Ionicons name="arrow-forward" size={20} color={colors.white} />}
          </Pressable>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        {!result && (
          <View style={styles.examples}>
            {EXAMPLES.map((e) => (
              <Pressable key={e} style={styles.example} onPress={() => run(e)} disabled={busy}>
                <Ionicons name="sparkles-outline" size={14} color={colors.primary} />
                <Text style={styles.exampleText}>{e}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {result && (
        <View style={styles.summary}>
          <Text style={styles.interpretation}>{result.filters?.interpretation}</Text>
          <View style={styles.filterChips}>
            {(result.filters?.numeric_filters ?? []).map((f, i) => (
              <Pill key={i} text={`${FIELD_LABELS[f.field] ?? f.field} ${f.op === "gt" ? ">" : "<"} ${f.value}`} color={colors.primary} />
            ))}
            {result.filters?.sectors?.map((s) => <Pill key={s} text={s} color="#0D9488" />)}
            {result.filters?.trend !== "any" && <Pill text={result.filters?.trend} color="#0284C7" />}
            {result.filters?.technical_rating !== "any" && <Pill text={`${result.filters?.technical_rating} rating`} color="#7C3AED" />}
            {result.filters?.above_sma200 !== "any" && <Pill text={`${result.filters?.above_sma200 === "yes" ? "above" : "below"} 200-day`} color="#D97706" />}
          </View>
          {result.summary ? <Text style={styles.summaryText}>{result.summary}</Text> : null}
          <Text style={styles.meta}>{result.results.length} matches · data for {result.coverage} stocks{result.data_as_of ? ` · as of ${new Date(result.data_as_of).toLocaleDateString()}` : ""}</Text>
        </View>
      )}
    </View>
  );

  return (
    <FlatList
      data={result?.results ?? []}
      keyExtractor={(r) => r.ticker}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: 40 }}
      renderItem={({ item }) => (
        <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} onPress={() => onOpenStock(item.ticker)}>
          <View style={styles.rowTop}>
            <TickerAvatar ticker={item.ticker} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.rowSub}>{item.ticker} · {item.sector} · ${item.price}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </View>
          <View style={styles.metrics}>
            {shown.map((f) => (
              <View key={f} style={styles.metric}>
                <Text style={styles.metricLabel}>{FIELD_LABELS[f] ?? f}</Text>
                <Text style={styles.metricValue}>{item[f] ?? "–"}</Text>
              </View>
            ))}
          </View>
          {item.note && <Text style={styles.note}>{item.note}</Text>}
        </Pressable>
      )}
      ListEmptyComponent={result && !busy ? <Text style={[styles.meta, { marginHorizontal: 16 }]}>No matches. Try loosening a condition.</Text> : null}
    />
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: "#0D9488", padding: 20, paddingBottom: 60, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroTitle: { color: colors.white, fontSize: 26, fontWeight: "800" },
  heroSub: { color: "#CCFBF1", fontSize: 14, marginTop: 6, lineHeight: 20 },
  searchCard: { backgroundColor: colors.card, marginHorizontal: 16, marginTop: -40, borderRadius: 22, padding: 14, shadowColor: "#1E1B4B", shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderColor: colors.primarySoft, borderRadius: 14, paddingLeft: 12, backgroundColor: "#FAFAFF" },
  input: { flex: 1, paddingVertical: 13, fontSize: 15, color: colors.text },
  go: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", margin: 3 },
  error: { color: colors.red, marginTop: 8 },
  examples: { marginTop: 12, gap: 8 },
  example: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primarySoft, borderRadius: 12, padding: 10 },
  exampleText: { color: colors.primaryDark, fontWeight: "600", flex: 1 },
  summary: { margin: 16, marginBottom: 4 },
  interpretation: { fontWeight: "800", color: colors.text, fontSize: 16 },
  filterChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  summaryText: { color: colors.text, marginTop: 10, lineHeight: 20 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 8 },
  row: { backgroundColor: colors.card, borderRadius: 18, padding: 14, marginHorizontal: 16, marginTop: 10, shadowColor: "#1E1B4B", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowTitle: { fontWeight: "800", color: colors.text, fontSize: 15 },
  rowSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  metrics: { flexDirection: "row", gap: 8, marginTop: 10 },
  metric: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, padding: 8 },
  metricLabel: { color: colors.muted, fontSize: 11 },
  metricValue: { color: colors.text, fontWeight: "800", fontSize: 15, marginTop: 2 },
  note: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 10 },
});
