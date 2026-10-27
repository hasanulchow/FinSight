import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { makeStyles, useTheme } from "../theme";

// Market heatmap: sectors as rows (height by total weight), stocks as tiles (width by weight),
// colored by daily change: loss color at -3% or worse, neutral at 0, gain color at +3% or better.

const ROW_UNIT = 220; // total height distributed across sectors

const mix = (a, b, t) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((x, i) => Math.round(x + (pb[i] - x) * t)).join(", ")})`;
};

/** Tile color for a % change in the active theme. */
export function changeColor(pct, c) {
  const neutral = c.dark ? "#1E2638" : "#E6E9F0";
  if (pct == null) return neutral;
  const t = Math.min(1, Math.abs(pct) / 3);
  const target = pct >= 0 ? (c.dark ? "#10B981" : "#059669") : c.dark ? "#E11D48" : "#DC2626";
  return mix(neutral, target, 0.25 + 0.75 * t);
}

/** Text color that stays readable on a change-colored tile. */
export const changeTextColor = (pct, c) => (pct != null && Math.abs(pct) >= 1 ? "#FFFFFF" : c.text);

export default function Heatmap({ tiles = [], onPress }) {
  const { c } = useTheme();
  const s = useStyles();
  const [width, setWidth] = useState(0);
  const groups = useMemo(() => {
    const by = new Map();
    for (const t of tiles) by.set(t.sector, [...(by.get(t.sector) ?? []), t]);
    const list = [...by.entries()].map(([sector, items]) => ({ sector, items: items.sort((a, b) => b.weight - a.weight), weight: items.reduce((sum, x) => sum + x.weight, 0) }));
    return list.sort((a, b) => b.weight - a.weight);
  }, [tiles]);
  const total = groups.reduce((sum, g) => sum + g.weight, 0) || 1;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && groups.map((g) => {
        const h = Math.min(96, Math.max(36, (g.weight / total) * ROW_UNIT * Math.max(1, groups.length / 3)));
        return (
          <View key={g.sector} style={{ marginBottom: 4 }}>
            <Text style={s.sector}>{g.sector}</Text>
            <View style={[s.row, { height: h }]}>
              {g.items.map((t) => {
                const w = (t.weight / g.weight) * width;
                const fg = changeTextColor(t.change_pct, c);
                return (
                  <Pressable
                    key={t.ticker}
                    onPress={() => onPress?.(t.ticker)}
                    accessibilityLabel={`${t.ticker} ${t.change_pct}%`}
                    style={({ hovered }) => [s.tile, { width: Math.max(w - 2, 2), backgroundColor: changeColor(t.change_pct, c) }, hovered && { opacity: 0.85 }]}
                  >
                    {w > 34 && (
                      <>
                        <Text style={[s.ticker, { color: fg }]} numberOfLines={1}>{t.ticker}</Text>
                        {h > 42 && <Text style={[s.change, { color: fg }]} numberOfLines={1}>{t.change_pct > 0 ? "+" : ""}{t.change_pct}%</Text>}
                      </>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
      <View style={s.scale}>
        {[-3, -2, -1, 0, 1, 2, 3].map((v) => (
          <View key={v} style={[s.scaleCell, { backgroundColor: changeColor(v, c) }]}>
            <Text style={[s.scaleText, { color: changeTextColor(v, c) }]}>{v > 0 ? "+" : ""}{v}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  sector: { color: c.muted, fontSize: 10, fontWeight: "700", marginBottom: 3, letterSpacing: 0.4, textTransform: "uppercase" },
  row: { flexDirection: "row", gap: 2 },
  tile: { borderRadius: 6, alignItems: "center", justifyContent: "center", overflow: "hidden", paddingHorizontal: 2 },
  ticker: { fontWeight: "800", fontSize: 11 },
  change: { fontSize: 10, fontWeight: "600", fontVariant: ["tabular-nums"] },
  scale: { flexDirection: "row", marginTop: 10, borderRadius: 8, overflow: "hidden" },
  scaleCell: { flex: 1, paddingVertical: 4, alignItems: "center" },
  scaleText: { fontSize: 9, fontWeight: "700" },
}));
