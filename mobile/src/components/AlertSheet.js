import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { colors } from "../theme";
import { PrimaryButton } from "./ui";

// Alert types, grouped for the picker (labels mirror server/src/lib/alerts.js)
export const ALERT_GROUPS = [
  { title: "Price", icon: "pricetag-outline", types: [
    { type: "price_above", label: "Rises above", needs: "price" },
    { type: "price_below", label: "Falls below", needs: "price" },
  ] },
  { title: "Indicators", icon: "analytics-outline", types: [
    { type: "rsi_below", label: "RSI drops below", needs: "rsi", placeholder: "30" },
    { type: "rsi_above", label: "RSI rises above", needs: "rsi", placeholder: "70" },
    { type: "golden_cross", label: "Golden cross (50 > 200-day)" },
    { type: "death_cross", label: "Death cross (50 < 200-day)" },
    { type: "macd_bullish_cross", label: "MACD bullish cross" },
    { type: "macd_bearish_cross", label: "MACD bearish cross" },
    { type: "volume_spike", label: "Volume spike (x average)", needs: "multiple", placeholder: "2" },
  ] },
  { title: "Events", icon: "notifications-outline", types: [
    { type: "earnings_soon", label: "Earnings within 3 days" },
    { type: "new_filing", label: "New SEC filing" },
    { type: "insider_buy", label: "Insider open-market buy" },
  ] },
];

/** Bottom sheet to create an alert for one ticker. */
export default function AlertSheet({ ticker, price, visible, onClose, onCreated }) {
  const [selected, setSelected] = useState(ALERT_GROUPS[0].types[0]);
  const [threshold, setThreshold] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const alert = await api.createAlert({ ticker, type: selected.type, threshold: selected.needs ? Number(threshold || selected.placeholder) : undefined, repeat });
      onCreated?.(alert);
      setThreshold("");
      onClose();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>New alert · {ticker}</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close"><Ionicons name="close" size={24} color={colors.muted} /></Pressable>
        </View>
        <ScrollView style={{ maxHeight: 360 }}>
          {ALERT_GROUPS.map((g) => (
            <View key={g.title}>
              <View style={styles.groupHead}>
                <Ionicons name={g.icon} size={14} color={colors.muted} />
                <Text style={styles.groupTitle}>{g.title}</Text>
              </View>
              <View style={styles.chips}>
                {g.types.map((t) => (
                  <Pressable key={t.type} style={[styles.chip, selected.type === t.type && styles.chipActive]} onPress={() => { setSelected(t); setThreshold(""); setError(null); }}>
                    <Text style={[styles.chipText, selected.type === t.type && { color: colors.white }]}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>

        {selected.needs && (
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>{selected.needs === "price" ? "Price ($)" : selected.needs === "rsi" ? "RSI level" : "Multiple of average"}</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              value={threshold}
              onChangeText={setThreshold}
              placeholder={selected.placeholder ?? (price ? String(price) : "")}
              placeholderTextColor={colors.muted}
            />
          </View>
        )}
        <View style={styles.repeatRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.inputLabel}>Repeat</Text>
            <Text style={styles.muted}>{repeat ? "Fires again after 24 hours if still true" : "Fires once, then turns off"}</Text>
          </View>
          <Switch value={repeat} onValueChange={setRepeat} trackColor={{ true: colors.primary }} />
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton title="Create alert" icon="notifications" onPress={save} loading={busy} style={{ marginTop: 14 }} />
        <Text style={styles.footnote}>Indicator alerts use end-of-day data. You'll get an in-app notification, plus a push notification on your phone if enabled.</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14, marginBottom: 6 },
  groupTitle: { color: colors.muted, fontWeight: "700", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1.5, borderColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  inputRow: { marginTop: 16 },
  inputLabel: { fontWeight: "700", color: colors.text, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 18, fontWeight: "700", color: colors.text },
  repeatRow: { flexDirection: "row", alignItems: "center", marginTop: 16 },
  muted: { color: colors.muted, fontSize: 12 },
  error: { color: colors.red, marginTop: 10 },
  footnote: { color: colors.muted, fontSize: 11, marginTop: 10, textAlign: "center" },
});
