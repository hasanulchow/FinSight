import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

// Market heatmap: sectors as rows (height by total weight), stocks as tiles (width by weight),
// colored by daily change from deep red (-3% or worse) to deep green (+3% or better).

const ROW_UNIT = 220; // total height distributed across sectors

export function changeColor(pct) {
  if (pct == null) return "#CBD5E1";
  const t = Math.max(-1, Math.min(1, pct / 3));
  if (t >= 0) return `rgb(${Math.round(226 - 210 * t)}, ${Math.round(232 - 69 * t)}, ${Math.round(240 - 166 * t)})`; // slate -> green
  const u = -t;
  return `rgb(${Math.round(226 + 3 * u)}, ${Math.round(232 - 180 * u)}, ${Math.round(240 - 180 * u)})`; // slate -> red
}

export default function Heatmap({ tiles = [], onPress }) {
  const [width, setWidth] = useState(0);
  const groups = useMemo(() => {
    const by = new Map();
    for (const t of tiles) by.set(t.sector, [...(by.get(t.sector) ?? []), t]);
    const list = [...by.entries()].map(([sector, items]) => ({ sector, items: items.sort((a, b) => b.weight - a.weight), weight: items.reduce((s, x) => s + x.weight, 0) }));
    return list.sort((a, b) => b.weight - a.weight);
  }, [tiles]);
  const total = groups.reduce((s, g) => s + g.weight, 0) || 1;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && groups.map((g) => {
        const h = Math.max(34, (g.weight / total) * ROW_UNIT * Math.max(1, groups.length / 3));
        return (
          <View key={g.sector} style={{ marginBottom: 3 }}>
            <Text style={styles.sector}>{g.sector}</Text>
            <View style={[styles.row, { height: h }]}>
              {g.items.map((t) => {
                const w = (t.weight / g.weight) * width;
                return (
                  <Pressable key={t.ticker} onPress={() => onPress?.(t.ticker)} style={[styles.tile, { width: Math.max(w - 2, 2), backgroundColor: changeColor(t.change_pct) }]}>
                    {w > 34 && (
                      <>
                        <Text style={styles.ticker} numberOfLines={1}>{t.ticker}</Text>
                        {h > 40 && <Text style={styles.change} numberOfLines={1}>{t.change_pct > 0 ? "+" : ""}{t.change_pct}%</Text>}
                      </>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
      <View style={styles.scale}>
        {[-3, -2, -1, 0, 1, 2, 3].map((v) => (
          <View key={v} style={[styles.scaleCell, { backgroundColor: changeColor(v) }]}>
            <Text style={styles.scaleText}>{v > 0 ? "+" : ""}{v}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sector: { color: colors.muted, fontSize: 10, fontWeight: "700", marginBottom: 2, textTransform: "uppercase" },
  row: { flexDirection: "row", gap: 2 },
  tile: { borderRadius: 4, alignItems: "center", justifyContent: "center", overflow: "hidden", paddingHorizontal: 2 },
  ticker: { color: "#0F172A", fontWeight: "800", fontSize: 11 },
  change: { color: "#0F172A", fontSize: 10, fontWeight: "600" },
  scale: { flexDirection: "row", marginTop: 8, borderRadius: 6, overflow: "hidden" },
  scaleCell: { flex: 1, paddingVertical: 3, alignItems: "center" },
  scaleText: { fontSize: 9, fontWeight: "700", color: "#0F172A" },
});
