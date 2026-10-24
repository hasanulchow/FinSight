import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, scoreColor, tickerColor } from "../theme";

/** Section card with a colored icon badge and accent bar. */
export function SectionCard({ title, section, right, children }) {
  return (
    <View style={styles.card}>
      <View style={[styles.accent, { backgroundColor: section.color }]} />
      <View style={styles.cardHeader}>
        <View style={[styles.iconBadge, { backgroundColor: section.soft }]}>
          <Ionicons name={section.icon} size={18} color={section.color} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Bullets({ items = [], color = colors.primary }) {
  return items.map((t, i) => (
    <View key={i} style={styles.bulletRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.body}>{t}</Text>
    </View>
  ));
}

export function Pill({ text, color, soft }) {
  return (
    <View style={[styles.pill, { backgroundColor: soft ?? `${color}1A` }]}>
      <Text style={[styles.pillText, { color }]}>{text}</Text>
    </View>
  );
}

export function TickerAvatar({ ticker, size = 44 }) {
  const color = tickerColor(ticker);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 3, backgroundColor: `${color}1A` }]}>
      <Text style={[styles.avatarText, { color, fontSize: size * 0.3 }]}>{ticker.slice(0, 4)}</Text>
    </View>
  );
}

export function ScoreBar({ label, value }) {
  const color = scoreColor(value);
  return (
    <View style={styles.scoreRow}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <View style={styles.scoreTrack}>
        <View style={[styles.scoreFill, { width: `${(value / 5) * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.scoreValue, { color }]}>{value}/5</Text>
    </View>
  );
}

export function PrimaryButton({ title, onPress, disabled, icon, loading, style }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, (disabled || loading) && { opacity: 0.55 }, pressed && { transform: [{ scale: 0.98 }] }, style]}
    >
      {icon && <Ionicons name={icon} size={18} color={colors.white} />}
      <Text style={styles.buttonText}>{loading ? "Please wait…" : title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, paddingLeft: 20, marginTop: 14, overflow: "hidden", shadowColor: "#1E1B4B", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  accent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 10 },
  iconBadge: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  cardTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.text },
  bulletRow: { flexDirection: "row", gap: 10, marginBottom: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 8 },
  body: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 22 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  pillText: { fontSize: 12, fontWeight: "700" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "800" },
  scoreRow: { flexDirection: "row", alignItems: "center", marginVertical: 5 },
  scoreLabel: { width: 110, color: colors.text, fontSize: 14 },
  scoreTrack: { flex: 1, height: 10, backgroundColor: colors.border, borderRadius: 5, overflow: "hidden" },
  scoreFill: { height: 10, borderRadius: 5 },
  scoreValue: { width: 40, textAlign: "right", fontWeight: "800" },
  button: { flexDirection: "row", gap: 8, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  buttonText: { color: colors.white, fontWeight: "700", fontSize: 16 },
});
