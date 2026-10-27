import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Banner, Input, Loading, PageHeader, SectionCard, Segmented } from "../components/ui";
import Heatmap, { changeColor, changeTextColor } from "../components/Heatmap";
import LineChart from "../components/LineChart";

const pct = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v}%`);

/** Markets tab: indices, sector performance, breadth, heatmap, top movers and a comparison chart. */
export default function MarketsScreen({ onOpenStock }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const { width } = useWindowDimensions();
  const sec = sections.markets;
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
  const colorOf = (v) => ((v ?? 0) >= 0 ? c.gain : c.loss);
  const maxSector = data ? Math.max(...data.sectors.map((x) => Math.abs(x.change_pct)), 0.5) : 1;

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={refreshing && !!data} onRefresh={load} tintColor={c.primary} />}>
      <PageHeader eyebrow="Markets" title="Today's market" subtitle={data ? `End of day ${new Date(`${data.session}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} vs previous session` : "US stocks, sectors and movers"} />

      {!data && !error && <Loading text="Loading the market snapshot… the first load can take about 30 seconds." />}
      {error && <Banner tone="error">{error}</Banner>}

      {data && (
        <>
          <View style={[s.indices, width < 520 && { flexWrap: "wrap" }]}>
            {data.indices.map((i) => (
              <Pressable key={i.ticker} style={({ hovered }) => [s.index, width < 520 && { flexBasis: "47%" }, hovered && { borderColor: c.borderStrong }]} onPress={() => onOpenStock(i.ticker)}>
                <Text style={s.indexName} numberOfLines={1}>{i.name}</Text>
                <Text style={s.indexPrice}>${i.close}</Text>
                <View style={s.indexRow}>
                  <Ionicons name={(i.change_pct ?? 0) >= 0 ? "caret-up" : "caret-down"} size={12} color={colorOf(i.change_pct)} />
                  <Text style={[s.indexChange, { color: colorOf(i.change_pct) }]}>{Math.abs(i.change_pct)}%</Text>
                  <Text style={s.indexTicker}>{i.ticker}</Text>
                </View>
              </Pressable>
            ))}
          </View>

          <SectionCard title="Breadth" subtitle={`${b.total.toLocaleString()} US stocks with volume`} section={{ ...sec, icon: "pulse-outline" }}>
            <View style={s.breadthBar}>
              <View style={{ flex: b.advancers, backgroundColor: c.gain }} />
              <View style={{ flex: Math.max(b.unchanged, 1), backgroundColor: c.borderStrong }} />
              <View style={{ flex: b.decliners, backgroundColor: c.loss }} />
            </View>
            <View style={s.breadthLabels}>
              <Text style={[s.breadthText, { color: c.gain }]}>{b.advancers.toLocaleString()} up · {Math.round((b.advancers / b.total) * 100)}%</Text>
              <Text style={[s.breadthText, { color: c.loss }]}>{b.decliners.toLocaleString()} down</Text>
            </View>
          </SectionCard>

          <SectionCard title="Sectors" subtitle="SPDR sector ETFs" section={{ ...sec, icon: "grid-outline" }}>
            {data.sectors.map((x) => {
              const w = (Math.abs(x.change_pct) / maxSector) * 50;
              return (
                <Pressable key={x.ticker} style={({ hovered }) => [s.sectorRow, hovered && { backgroundColor: c.surfaceAlt }]} onPress={() => onOpenStock(x.ticker)}>
                  <Text style={s.sectorName} numberOfLines={1}>{x.name}</Text>
                  <View style={s.sectorTrack}>
                    <View style={s.sectorMid} />
                    <View style={[s.sectorFill, (x.change_pct ?? 0) >= 0 ? { left: "50%", width: `${w}%`, backgroundColor: c.gain } : { right: "50%", width: `${w}%`, backgroundColor: c.loss }]} />
                  </View>
                  <Text style={[s.sectorPct, { color: colorOf(x.change_pct) }]}>{pct(x.change_pct)}</Text>
                </Pressable>
              );
            })}
          </SectionCard>

          <SectionCard title="Heatmap" subtitle="About 100 large caps, sized by market cap" section={{ ...sec, icon: "apps-outline" }}>
            <Heatmap tiles={data.heatmap} onPress={onOpenStock} />
          </SectionCard>

          <SectionCard title="Top movers" subtitle="Liquid stocks: $5+ price, $20M+ traded" section={{ ...sec, icon: "flash-outline" }}>
            <Segmented options={[["gainers", "Gainers"], ["losers", "Losers"], ["active", "Most active"]]} value={movers} onChange={setMovers} />
            <View style={{ marginTop: 6 }}>
              {list.map((m, idx) => (
                <Pressable key={m.ticker} style={({ hovered }) => [s.mover, hovered && { backgroundColor: c.surfaceAlt }]} onPress={() => onOpenStock(m.ticker)}>
                  <Text style={s.rank}>{idx + 1}</Text>
                  <Text style={s.moverTicker}>{m.ticker}</Text>
                  <Text style={s.moverPrice}>${m.close}</Text>
                  <Text style={s.moverVol}>${(m.dollar_volume / 1e6).toFixed(0)}M</Text>
                  <View style={[s.moverBadge, { backgroundColor: changeColor(m.change_pct, c) }]}>
                    <Text style={[s.moverPct, { color: changeTextColor(m.change_pct, c) }]}>{pct(m.change_pct)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </SectionCard>
        </>
      )}

      <SectionCard title="Compare performance" subtitle="Up to 5 tickers, 1 year, rebased to 0%" section={{ ...sec, icon: "git-compare-outline" }}>
        <View style={s.compareRow}>
          <Input style={{ flex: 1 }} value={compareInput} onChangeText={setCompareInput} autoCapitalize="characters" autoCorrect={false} placeholder="AAPL, MSFT, SPY" onSubmitEditing={runCompare} />
          <Pressable style={s.compareGo} onPress={runCompare} disabled={compareBusy} accessibilityLabel="Compare">
            {compareBusy ? <ActivityIndicator color={c.onPrimary} size="small" /> : <Ionicons name="arrow-forward" size={20} color={c.onPrimary} />}
          </Pressable>
        </View>
        {compareError && <Banner tone="error">{compareError}</Banner>}
        {compare ? (
          <>
            <View style={s.returns}>
              {compare.tickers.map((t) => (
                <View key={t} style={s.returnItem}>
                  <Text style={s.returnTicker}>{t}</Text>
                  <Text style={[s.returnValue, { color: colorOf(compare.total_return_pct[t]) }]}>{pct(compare.total_return_pct[t])}</Text>
                </View>
              ))}
            </View>
            <LineChart
              data={compare.points.map((p) => ({ x: p.date, ...p }))}
              series={compare.tickers.map((t) => ({ key: t, label: t }))}
              format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
              xLabel={(d) => new Date(`${d}T12:00:00Z`).toLocaleDateString()}
              height={220}
              zero
            />
            {compare.missing.length > 0 && <Text style={s.small}>Not found: {compare.missing.join(", ")}</Text>}
          </>
        ) : (
          <Text style={s.small}>Enter tickers and tap the arrow.</Text>
        )}
      </SectionCard>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  small: { color: c.muted, fontSize: 12, marginTop: 8 },
  indices: { flexDirection: "row", gap: 8 },
  index: { flex: 1, backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.border, padding: 14 },
  indexName: { color: c.textSecondary, fontSize: 12, fontWeight: "600" },
  indexPrice: { color: c.text, fontSize: 19, fontWeight: "800", marginTop: 4, letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  indexRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 4 },
  indexChange: { fontWeight: "800", fontSize: 13, fontVariant: ["tabular-nums"] },
  indexTicker: { color: c.muted, fontSize: 11, marginLeft: "auto" },
  breadthBar: { flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", gap: 2 },
  breadthLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  breadthText: { fontWeight: "700", fontSize: 13 },
  sectorRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 6, borderRadius: 10 },
  sectorName: { width: 132, color: c.text, fontSize: 13 },
  sectorTrack: { flex: 1, height: 10 },
  sectorMid: { position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, backgroundColor: c.borderStrong },
  sectorFill: { position: "absolute", top: 0, bottom: 0, borderRadius: 4 },
  sectorPct: { width: 60, textAlign: "right", fontWeight: "800", fontSize: 13, fontVariant: ["tabular-nums"] },
  mover: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  rank: { width: 18, color: c.muted, fontSize: 12, fontWeight: "700" },
  moverTicker: { width: 60, fontWeight: "800", color: c.text },
  moverPrice: { flex: 1, color: c.textSecondary, fontVariant: ["tabular-nums"] },
  moverVol: { color: c.muted, fontSize: 12, width: 60, textAlign: "right" },
  moverBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, minWidth: 76, alignItems: "center" },
  moverPct: { fontWeight: "800", fontSize: 13, fontVariant: ["tabular-nums"] },
  compareRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  compareGo: { width: 50, borderRadius: 14, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
  returns: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  returnItem: { backgroundColor: c.surfaceAlt, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  returnTicker: { color: c.muted, fontSize: 11, fontWeight: "700" },
  returnValue: { fontSize: 16, fontWeight: "800", fontVariant: ["tabular-nums"] },
}));
