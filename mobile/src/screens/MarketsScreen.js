import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { colors } from "../theme";
import { SectionCard } from "../components/ui";
import Heatmap, { changeColor } from "../components/Heatmap";
import LineChart from "../components/LineChart";

const MK = { color: "#2563EB", soft: "#DBEAFE", icon: "globe-outline" };
const pct = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v}%`);
const up = (v) => (v ?? 0) >= 0;

/** Markets tab: indices, sector performance, breadth, heatmap, top movers and a comparison chart. */
export default function MarketsScreen({ onOpenStock }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [movers, setMovers] = useState("gainers");
  const [compareInput, setCompareInput] = useState("SPY, QQQ, AAPL");
  const [compare, setCompare] = useState(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareError, setCompareError] = useState(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setData(await api.market());
    } catch (e) {
      setError(e.message);
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runCompare() {
    setCompareBusy(true);
    setCompareError(null);
    try {
      setCompare(await api.compare(compareInput.split(/[\s,]+/).filter(Boolean)));
    } catch (e) {
      setCompareError(e.message);
    }
    setCompareBusy(false);
  }

  const b = data?.breadth;
  const list = data ? data[movers === "active" ? "most_active" : movers] : [];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={refreshing && !!data} onRefresh={load} tintColor={MK.color} />}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Markets</Text>
        <Text style={styles.heroSub}>{data ? `Session ${data.session} vs ${data.previous_session} (end of day)` : "US market snapshot"}</Text>
        {data && (
          <View style={styles.indices}>
            {data.indices.map((i) => (
              <Pressable key={i.ticker} style={styles.index} onPress={() => onOpenStock(i.ticker)}>
                <Text style={styles.indexName} numberOfLines={1}>{i.name}</Text>
                <Text style={styles.indexPrice}>${i.close}</Text>
                <Text style={[styles.indexChange, { color: up(i.change_pct) ? "#A7F3D0" : "#FECACA" }]}>{pct(i.change_pct)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        {!data && !error && (
          <View style={styles.loading}>
            <ActivityIndicator color={MK.color} />
            <Text style={styles.muted}>Loading the market snapshot…</Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}

        {data && (
          <>
            <SectionCard title="Breadth" section={{ ...MK, icon: "pulse-outline" }}>
              <View style={styles.breadthBar}>
                <View style={{ flex: b.advancers, backgroundColor: colors.green }} />
                <View style={{ flex: b.unchanged, backgroundColor: colors.border }} />
                <View style={{ flex: b.decliners, backgroundColor: colors.red }} />
              </View>
              <View style={styles.breadthLabels}>
                <Text style={[styles.breadthText, { color: colors.green }]}>{b.advancers.toLocaleString()} up</Text>
                <Text style={[styles.breadthText, { color: colors.red }]}>{b.decliners.toLocaleString()} down</Text>
              </View>
              <Text style={styles.small}>{Math.round((b.advancers / b.total) * 100)}% of {b.total.toLocaleString()} US stocks rose.</Text>
            </SectionCard>

            <SectionCard title="Sectors" section={{ ...MK, icon: "grid-outline" }}>
              {data.sectors.map((s) => {
                const width = Math.min(100, (Math.abs(s.change_pct) / Math.max(...data.sectors.map((x) => Math.abs(x.change_pct)), 0.5)) * 100);
                return (
                  <Pressable key={s.ticker} style={styles.sectorRow} onPress={() => onOpenStock(s.ticker)}>
                    <Text style={styles.sectorName} numberOfLines={1}>{s.name}</Text>
                    <View style={styles.sectorTrack}>
                      <View style={styles.sectorMid} />
                      <View style={[styles.sectorFill, up(s.change_pct) ? { left: "50%", width: `${width / 2}%`, backgroundColor: colors.green } : { right: "50%", width: `${width / 2}%`, backgroundColor: colors.red }]} />
                    </View>
                    <Text style={[styles.sectorPct, { color: up(s.change_pct) ? colors.green : colors.red }]}>{pct(s.change_pct)}</Text>
                  </Pressable>
                );
              })}
            </SectionCard>

            <SectionCard title="Heatmap" section={{ ...MK, icon: "apps-outline" }}>
              <Heatmap tiles={data.heatmap} onPress={onOpenStock} />
              <Text style={styles.small}>~100 large caps, sized by market cap. Tap a tile to open the stock.</Text>
            </SectionCard>

            <SectionCard title="Top movers" section={{ ...MK, icon: "flash-outline" }}>
              <View style={styles.segment}>
                {[["gainers", "Gainers"], ["losers", "Losers"], ["active", "Most active"]].map(([k, label]) => (
                  <Pressable key={k} onPress={() => setMovers(k)} style={[styles.segmentItem, movers === k && styles.segmentActive]}>
                    <Text style={[styles.segmentText, movers === k && { color: MK.color }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              {list.map((m) => (
                <Pressable key={m.ticker} style={styles.mover} onPress={() => onOpenStock(m.ticker)}>
                  <Text style={styles.moverTicker}>{m.ticker}</Text>
                  <Text style={styles.moverPrice}>${m.close}</Text>
                  <Text style={styles.small}>${(m.dollar_volume / 1e6).toFixed(0)}M traded</Text>
                  <View style={[styles.moverBadge, { backgroundColor: changeColor(m.change_pct) }]}>
                    <Text style={styles.moverPct}>{pct(m.change_pct)}</Text>
                  </View>
                </Pressable>
              ))}
              <Text style={styles.small}>Liquid stocks only (price $5+, $20M+ traded).</Text>
            </SectionCard>
          </>
        )}

        <SectionCard title="Compare performance" section={{ ...MK, icon: "git-compare-outline" }}>
          <View style={styles.compareRow}>
            <TextInput style={styles.compareInput} value={compareInput} onChangeText={setCompareInput} autoCapitalize="characters" autoCorrect={false} placeholder="AAPL, MSFT, SPY" placeholderTextColor={colors.muted} onSubmitEditing={runCompare} />
            <Pressable style={styles.compareGo} onPress={runCompare} disabled={compareBusy} accessibilityLabel="Compare">
              {compareBusy ? <ActivityIndicator color={colors.white} size="small" /> : <Ionicons name="arrow-forward" size={20} color={colors.white} />}
            </Pressable>
          </View>
          {compareError && <Text style={styles.error}>{compareError}</Text>}
          {compare ? (
            <>
              <LineChart
                data={compare.points.map((p) => ({ x: p.date, ...p }))}
                series={compare.tickers.map((t) => ({ key: t, label: t }))}
                format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
                xLabel={(d) => d}
                zero
              />
              <Text style={styles.small}>Return since {compare.from}{compare.missing.length ? ` · not found: ${compare.missing.join(", ")}` : ""}</Text>
            </>
          ) : (
            <Text style={styles.muted}>Up to 5 tickers, 1 year of daily closes, rebased to 0%.</Text>
          )}
        </SectionCard>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: MK.color, padding: 20, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroTitle: { color: colors.white, fontSize: 26, fontWeight: "800" },
  heroSub: { color: "#DBEAFE", fontSize: 13, marginTop: 4 },
  indices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  index: { width: "48.5%", backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 14, padding: 10 },
  indexName: { color: "#DBEAFE", fontSize: 12, fontWeight: "700" },
  indexPrice: { color: colors.white, fontSize: 18, fontWeight: "800", marginTop: 2 },
  indexChange: { fontWeight: "800", fontSize: 13 },
  loading: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 20 },
  muted: { color: colors.muted, fontSize: 13 },
  small: { color: colors.muted, fontSize: 12, marginTop: 8 },
  error: { color: colors.red, marginTop: 10 },
  breadthBar: { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden" },
  breadthLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  breadthText: { fontWeight: "800" },
  sectorRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  sectorName: { width: 120, color: colors.text, fontSize: 13 },
  sectorTrack: { flex: 1, height: 10 },
  sectorMid: { position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, backgroundColor: colors.border },
  sectorFill: { position: "absolute", top: 0, bottom: 0, borderRadius: 4 },
  sectorPct: { width: 56, textAlign: "right", fontWeight: "800", fontSize: 13 },
  segment: { flexDirection: "row", backgroundColor: colors.bg, borderRadius: 10, padding: 3, marginBottom: 6 },
  segmentItem: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: "center" },
  segmentActive: { backgroundColor: colors.card },
  segmentText: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  mover: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  moverTicker: { width: 60, fontWeight: "800", color: colors.text },
  moverPrice: { width: 72, color: colors.text },
  moverBadge: { marginLeft: "auto", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, minWidth: 70, alignItems: "center" },
  moverPct: { fontWeight: "800", color: "#0F172A", fontSize: 13 },
  compareRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  compareInput: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontWeight: "700", color: colors.text },
  compareGo: { width: 46, borderRadius: 12, backgroundColor: MK.color, alignItems: "center", justifyContent: "center" },
});
