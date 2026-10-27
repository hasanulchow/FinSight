import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import Svg, { Line, Path, Text as SvgText } from "react-native-svg";
import { makeStyles, useTheme, alpha } from "../theme";

/** Series palette for the active theme. */
export const seriesColors = (c) => [c.primary, c.hue("amber"), c.hue("emerald"), c.hue("rose"), c.hue("sky")];
const AXIS_W = 46;

/**
 * Multi-series line chart with touch readout.
 * data: [{ x (label or ms), [key]: number }], series: [{ key, label, color? , fill? }]
 * format(v) formats values; zero draws a baseline at 0.
 */
export default function LineChart({ data = [], series = [], height = 200, format = (v) => v.toFixed(1), zero = false, xLabel = (x) => String(x) }) {
  const { c } = useTheme();
  const styles = useStyles();
  const SERIES_COLORS = seriesColors(c);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);
  const plotW = Math.max(0, width - AXIS_W);

  const geo = useMemo(() => {
    if (!data.length || !plotW) return null;
    const vals = data.flatMap((d) => series.map((s) => d[s.key])).filter((v) => v != null && Number.isFinite(v));
    if (zero) vals.push(0);
    let max = Math.max(...vals), min = Math.min(...vals);
    const pad = (max - min) * 0.08 || 1;
    max += pad;
    min -= pad;
    const x = (i) => (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const y = (v) => ((max - v) / (max - min)) * height;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max - f * (max - min));
    const paths = series.map((s) => {
      let d = "", pen = false;
      data.forEach((p, i) => {
        const v = p[s.key];
        if (v == null || !Number.isFinite(v)) return (pen = false);
        d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
        pen = true;
      });
      const fill = s.fill ? `${d}L${x(data.length - 1).toFixed(1)},${y(Math.max(min, Math.min(0, max))).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(min, Math.min(0, max))).toFixed(1)} Z` : null;
      return { ...s, d, fillPath: fill };
    });
    return { x, y, ticks, paths };
  }, [data, series, plotW, height, zero]);

  const touch = (e) => {
    if (!geo || !data.length) return;
    const i = Math.round((e.nativeEvent.locationX / plotW) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };
  const point = data[hover ?? data.length - 1];

  return (
    <View>
      {point && (
        <View style={styles.readout}>
          <Text style={styles.readoutX}>{xLabel(point.x)}</Text>
          <View style={styles.readoutRow}>
            {series.map((s, i) => (
              <Text key={s.key} style={[styles.readoutVal, { color: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }]}>
                {s.label} {point[s.key] != null ? format(point[s.key]) : "–"}
              </Text>
            ))}
          </View>
        </View>
      )}
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={touch}
        onResponderMove={touch}
        onResponderRelease={() => setHover(null)}
        style={{ height }}
      >
        {geo && (
          <Svg width={width} height={height}>
            {geo.ticks.map((v, i) => (
              <Line key={`g${i}`} x1={0} x2={plotW} y1={geo.y(v)} y2={geo.y(v)} stroke={c.border} strokeWidth={1} />
            ))}
            {geo.ticks.map((v, i) => (
              <SvgText key={`t${i}`} x={plotW + 4} y={Math.max(10, geo.y(v) + 4)} fontSize={10} fill={c.muted}>{format(v)}</SvgText>
            ))}
            {zero && <Line x1={0} x2={plotW} y1={geo.y(0)} y2={geo.y(0)} stroke={c.muted} strokeWidth={1} strokeDasharray="4,3" />}
            {geo.paths.map((p, i) => (p.fillPath ? <Path key={`f${p.key}`} d={p.fillPath} fill={p.color ?? SERIES_COLORS[i % SERIES_COLORS.length]} opacity={0.12} /> : null))}
            {geo.paths.map((p, i) => (
              <Path key={p.key} d={p.d} stroke={p.color ?? SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={p.width ?? 2} strokeDasharray={p.dashed ? "5,4" : undefined} fill="none" />
            ))}
            {hover != null && <Line x1={geo.x(hover)} x2={geo.x(hover)} y1={0} y2={height} stroke={c.text} strokeWidth={0.8} strokeDasharray="2,2" />}
          </Svg>
        )}
      </View>
      <View style={styles.legend}>
        {series.map((s, i) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  readout: { marginBottom: 6 },
  readoutX: { color: c.muted, fontSize: 12 },
  readoutRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 2 },
  readoutVal: { fontWeight: "800", fontSize: 13 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { color: c.muted, fontSize: 11 },
}));
