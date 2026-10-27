import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { colors } from "../theme";

// Candlestick chart drawn with react-native-svg (iOS, Android and web):
// price candles + SMA50/SMA200 + Bollinger Bands, volume bars, and an RSI(14) panel with 30/70 lines.
// Touch and drag to inspect a session.

const RANGES = [
  { label: "1M", n: 21 },
  { label: "3M", n: 63 },
  { label: "6M", n: 126 },
  { label: "1Y", n: 252 },
];
const PRICE_H = 200;
const VOL_H = 40;
const RSI_H = 70;
const GAP = 8;
const AXIS_W = 44;

const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });

function linePath(points) {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (p == null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)} `;
    pen = true;
  }
  return d;
}

export default function CandleChart({ data = [], showBands = true }) {
  const available = RANGES.filter((r) => r.n <= Math.max(data.length, 21));
  const [range, setRange] = useState(available.find((r) => r.label === "6M") ?? available[available.length - 1]);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);

  const series = useMemo(() => data.slice(-range.n), [data, range]);
  const plotW = Math.max(0, width - AXIS_W);

  const geo = useMemo(() => {
    if (!series.length || !plotW) return null;
    const highs = series.flatMap((d) => [d.h, showBands ? d.bbUpper : null, d.sma50, d.sma200]).filter((x) => x != null);
    const lows = series.flatMap((d) => [d.l, showBands ? d.bbLower : null, d.sma50, d.sma200]).filter((x) => x != null);
    let max = Math.max(...highs), min = Math.min(...lows);
    const pad = (max - min) * 0.05 || 1;
    max += pad;
    min -= pad;
    const step = plotW / series.length;
    const x = (i) => i * step + step / 2;
    const y = (v) => ((max - v) / (max - min)) * PRICE_H;
    const maxVol = Math.max(...series.map((d) => d.v)) || 1;
    const volY = (v) => PRICE_H + GAP + VOL_H - (v / maxVol) * VOL_H;
    const rsiTop = PRICE_H + GAP + VOL_H + GAP;
    const rsiY = (v) => rsiTop + ((100 - v) / 100) * RSI_H;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max - f * (max - min));
    return { step, x, y, volY, rsiY, rsiTop, ticks, candleW: Math.max(1, step * 0.65) };
  }, [series, plotW, showBands]);

  const totalH = PRICE_H + GAP + VOL_H + GAP + RSI_H;
  const active = hover != null ? series[hover] : series[series.length - 1];
  const prevClose = hover != null && hover > 0 ? series[hover - 1]?.c : series[series.length - 2]?.c;
  const change = active && prevClose ? ((active.c - prevClose) / prevClose) * 100 : null;

  const touch = (e) => {
    if (!geo) return;
    const i = Math.floor(e.nativeEvent.locationX / geo.step);
    setHover(Math.min(series.length - 1, Math.max(0, i)));
  };

  if (!data.length) return <Text style={styles.muted}>No price history available.</Text>;

  return (
    <View>
      {/* Readout for the touched (or latest) session */}
      {active && (
        <View style={styles.readout}>
          <Text style={styles.readoutDate}>{fmtDate(active.t)}</Text>
          <Text style={styles.readoutText}>
            O {active.o} H {active.h} L {active.l} C <Text style={{ fontWeight: "800" }}>{active.c}</Text>
            {change != null && <Text style={{ color: change >= 0 ? colors.green : colors.red }}>  {change >= 0 ? "+" : ""}{change.toFixed(2)}%</Text>}
          </Text>
          <Text style={styles.readoutSub}>RSI {active.rsi ?? "–"} · SMA50 {active.sma50 ?? "–"} · SMA200 {active.sma200 ?? "–"}</Text>
        </View>
      )}

      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={touch}
        onResponderMove={touch}
        onResponderRelease={() => setHover(null)}
        style={{ height: totalH }}
      >
        {geo && (
          <Svg width={width} height={totalH}>
            {/* Grid + price axis */}
            {geo.ticks.map((v, i) => (
              <Line key={`g${i}`} x1={0} x2={plotW} y1={geo.y(v)} y2={geo.y(v)} stroke={colors.border} strokeWidth={1} />
            ))}
            {geo.ticks.map((v, i) => (
              <SvgText key={`t${i}`} x={plotW + 4} y={geo.y(v) + 4} fontSize={10} fill={colors.muted}>{v >= 1000 ? v.toFixed(0) : v.toFixed(2)}</SvgText>
            ))}

            {/* Bollinger Bands */}
            {showBands && <Path d={linePath(series.map((d, i) => (d.bbUpper != null ? [geo.x(i), geo.y(d.bbUpper)] : null)))} stroke="#A5B4FC" strokeWidth={1} strokeDasharray="3,3" fill="none" />}
            {showBands && <Path d={linePath(series.map((d, i) => (d.bbLower != null ? [geo.x(i), geo.y(d.bbLower)] : null)))} stroke="#A5B4FC" strokeWidth={1} strokeDasharray="3,3" fill="none" />}

            {/* Candles */}
            {series.map((d, i) => {
              const up = d.c >= d.o;
              const c = up ? colors.green : colors.red;
              const top = geo.y(Math.max(d.o, d.c));
              const h = Math.max(1, Math.abs(geo.y(d.o) - geo.y(d.c)));
              return [
                <Line key={`w${i}`} x1={geo.x(i)} x2={geo.x(i)} y1={geo.y(d.h)} y2={geo.y(d.l)} stroke={c} strokeWidth={1} />,
                <Rect key={`b${i}`} x={geo.x(i) - geo.candleW / 2} y={top} width={geo.candleW} height={h} fill={c} />,
              ];
            })}

            {/* Moving averages */}
            <Path d={linePath(series.map((d, i) => (d.sma50 != null ? [geo.x(i), geo.y(d.sma50)] : null)))} stroke="#F59E0B" strokeWidth={1.6} fill="none" />
            <Path d={linePath(series.map((d, i) => (d.sma200 != null ? [geo.x(i), geo.y(d.sma200)] : null)))} stroke="#7C3AED" strokeWidth={1.6} fill="none" />

            {/* Volume */}
            {series.map((d, i) => (
              <Rect key={`v${i}`} x={geo.x(i) - geo.candleW / 2} y={geo.volY(d.v)} width={geo.candleW} height={PRICE_H + GAP + VOL_H - geo.volY(d.v)} fill={d.c >= d.o ? "#A7F3D0" : "#FECACA"} />
            ))}

            {/* RSI panel with 30/70 lines */}
            <Rect x={0} y={geo.rsiY(70)} width={plotW} height={geo.rsiY(30) - geo.rsiY(70)} fill="#EEF2FF" />
            <Line x1={0} x2={plotW} y1={geo.rsiY(70)} y2={geo.rsiY(70)} stroke={colors.red} strokeWidth={0.8} strokeDasharray="4,3" />
            <Line x1={0} x2={plotW} y1={geo.rsiY(30)} y2={geo.rsiY(30)} stroke={colors.green} strokeWidth={0.8} strokeDasharray="4,3" />
            <SvgText x={plotW + 4} y={geo.rsiY(70) + 4} fontSize={10} fill={colors.muted}>70</SvgText>
            <SvgText x={plotW + 4} y={geo.rsiY(30) + 4} fontSize={10} fill={colors.muted}>30</SvgText>
            <Path d={linePath(series.map((d, i) => (d.rsi != null ? [geo.x(i), geo.rsiY(d.rsi)] : null)))} stroke={colors.primary} strokeWidth={1.5} fill="none" />

            {/* Crosshair */}
            {hover != null && <Line x1={geo.x(hover)} x2={geo.x(hover)} y1={0} y2={totalH} stroke={colors.text} strokeWidth={0.8} strokeDasharray="2,2" />}
          </Svg>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.legend}>
          <Legend color="#F59E0B" label="SMA 50" />
          <Legend color="#7C3AED" label="SMA 200" />
          {showBands && <Legend color="#A5B4FC" label="Bollinger" dashed />}
          <Legend color={colors.primary} label="RSI" />
        </View>
        <View style={styles.ranges}>
          {available.map((r) => (
            <Pressable key={r.label} onPress={() => setRange(r)} style={[styles.range, range.label === r.label && styles.rangeActive]}>
              <Text style={[styles.rangeText, range.label === r.label && { color: colors.white }]}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function Legend({ color, label, dashed }) {
  return (
    <View style={styles.legendItem}>
      <View style={{ width: 12, height: 3, backgroundColor: color, opacity: dashed ? 0.7 : 1, borderRadius: 2 }} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted },
  readout: { marginBottom: 8 },
  readoutDate: { color: colors.muted, fontSize: 12 },
  readoutText: { color: colors.text, fontSize: 13, marginTop: 2 },
  readoutSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  footer: { marginTop: 8, gap: 8 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { color: colors.muted, fontSize: 11 },
  ranges: { flexDirection: "row", gap: 6, alignSelf: "flex-start" },
  range: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.bg },
  rangeActive: { backgroundColor: colors.primary },
  rangeText: { fontWeight: "700", fontSize: 12, color: colors.muted },
});
