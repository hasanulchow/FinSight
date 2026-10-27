import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, ClipPath, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { colors } from "../theme";

const H = 220;
const AXIS_W = 52;
const fmt = (v) => `${v >= 0 ? "+" : "-"}$${Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(1)}k` : Math.abs(v).toFixed(0)}`;

/**
 * Options payoff diagram: P/L at expiration (solid, green above zero / red below) and today (dashed),
 * with the spot price, breakevens and the expected-move range. Touch to read P/L at any price.
 */
export default function PayoffChart({ curve = [], spot, breakevens = [], expectedMove }) {
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);
  const plotW = Math.max(0, width - AXIS_W);

  const geo = useMemo(() => {
    if (!curve.length || !plotW) return null;
    const vals = curve.flatMap((p) => [p.expiry, p.today]).concat(0);
    let max = Math.max(...vals), min = Math.min(...vals);
    const pad = (max - min) * 0.08 || 1;
    max += pad;
    min -= pad;
    const pMin = curve[0].price, pMax = curve[curve.length - 1].price;
    const x = (price) => ((price - pMin) / (pMax - pMin)) * plotW;
    const y = (v) => ((max - v) / (max - min)) * H;
    const line = (k) => curve.map((p, i) => `${i ? "L" : "M"}${x(p.price).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
    const area = `${line("expiry")} L${x(pMax).toFixed(1)},${y(0).toFixed(1)} L${x(pMin).toFixed(1)},${y(0).toFixed(1)} Z`;
    return { x, y, expiry: line("expiry"), today: line("today"), area, zeroY: y(0), ticks: [max, (max + min) / 2, min, 0], pMin, pMax };
  }, [curve, plotW]);

  const touch = (e) => {
    if (!geo) return;
    const price = geo.pMin + (e.nativeEvent.locationX / plotW) * (geo.pMax - geo.pMin);
    const nearest = curve.reduce((best, p) => (Math.abs(p.price - price) < Math.abs(best.price - price) ? p : best), curve[0]);
    setHover(nearest);
  };
  const shown = hover ?? curve.reduce((best, p) => (Math.abs(p.price - spot) < Math.abs(best.price - spot) ? p : best), curve[0] ?? {});

  return (
    <View>
      {shown?.price != null && (
        <View style={styles.readout}>
          <Text style={styles.readoutLabel}>If {hover ? "price is" : "price stays at"} ${shown.price}</Text>
          <Text style={styles.readoutText}>
            At expiration <Text style={{ color: shown.expiry >= 0 ? colors.green : colors.red, fontWeight: "800" }}>{fmt(shown.expiry)}</Text>
            {"   "}Today <Text style={{ color: shown.today >= 0 ? colors.green : colors.red, fontWeight: "800" }}>{fmt(shown.today)}</Text>
          </Text>
        </View>
      )}
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={touch}
        onResponderMove={touch}
        onResponderRelease={() => setHover(null)}
        style={{ height: H + 18 }}
      >
        {geo && (
          <Svg width={width} height={H + 18}>
            <Defs>
              <ClipPath id="above"><Rect x={0} y={0} width={plotW} height={geo.zeroY} /></ClipPath>
              <ClipPath id="below"><Rect x={0} y={geo.zeroY} width={plotW} height={H - geo.zeroY} /></ClipPath>
            </Defs>
            {/* Expected-move band */}
            {expectedMove && <Rect x={geo.x(expectedMove.low)} y={0} width={Math.max(0, geo.x(expectedMove.high) - geo.x(expectedMove.low))} height={H} fill="#EEF2FF" />}
            {/* Profit / loss shading */}
            <Path d={geo.area} fill={colors.green} opacity={0.15} clipPath="url(#above)" />
            <Path d={geo.area} fill={colors.red} opacity={0.15} clipPath="url(#below)" />
            <Line x1={0} x2={plotW} y1={geo.zeroY} y2={geo.zeroY} stroke={colors.muted} strokeWidth={1} />
            {geo.ticks.map((v, i) => (
              <SvgText key={i} x={plotW + 4} y={geo.y(v) + 4} fontSize={10} fill={colors.muted}>{fmt(v)}</SvgText>
            ))}
            <Path d={geo.today} stroke="#7C3AED" strokeWidth={1.6} strokeDasharray="5,4" fill="none" />
            <Path d={geo.expiry} stroke={colors.text} strokeWidth={2.2} fill="none" />
            {/* Spot and breakevens */}
            {spot != null && <Line x1={geo.x(spot)} x2={geo.x(spot)} y1={0} y2={H} stroke={colors.primary} strokeWidth={1.2} />}
            {spot != null && <SvgText x={geo.x(spot) + 3} y={12} fontSize={10} fill={colors.primary}>Now ${spot}</SvgText>}
            {breakevens.map((b) => (
              <Line key={b} x1={geo.x(b)} x2={geo.x(b)} y1={0} y2={H} stroke={colors.amber} strokeWidth={1} strokeDasharray="3,3" />
            ))}
            <SvgText x={0} y={H + 14} fontSize={10} fill={colors.muted}>${geo.pMin.toFixed(0)}</SvgText>
            <SvgText x={plotW - 30} y={H + 14} fontSize={10} fill={colors.muted}>${geo.pMax.toFixed(0)}</SvgText>
            {hover && <Line x1={geo.x(hover.price)} x2={geo.x(hover.price)} y1={0} y2={H} stroke={colors.text} strokeWidth={0.8} strokeDasharray="2,2" />}
          </Svg>
        )}
      </View>
      <View style={styles.legend}>
        <Legend color={colors.text} label="At expiration" />
        <Legend color="#7C3AED" label="Today (model)" dashed />
        <Legend color={colors.amber} label="Breakeven" dashed />
        {expectedMove && <Legend color="#C7D2FE" label="Expected move" thick />}
      </View>
    </View>
  );
}

function Legend({ color, label, thick }) {
  return (
    <View style={styles.legendItem}>
      <View style={{ width: 14, height: thick ? 8 : 3, borderRadius: 2, backgroundColor: color }} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { marginBottom: 6 },
  readoutLabel: { color: colors.muted, fontSize: 12 },
  readoutText: { color: colors.text, fontSize: 13, marginTop: 2 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { color: colors.muted, fontSize: 11 },
});
