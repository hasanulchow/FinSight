import { useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { ErrorNotice } from "./Upgrade";
import { Button, Chip, Input } from "./ui";

// Alert types, grouped for the picker (labels mirror server/src/lib/alerts.js)
export const ALERT_GROUPS = [
  { title: "Price", icon: "pricetag-outline", types: [
    { type: "price_above", label: "Rises above", needs: "price" },
    { type: "price_below", label: "Falls below", needs: "price" },
  ] },
  { title: "Indicators", icon: "analytics-outline", types: [
    { type: "rsi_below", label: "RSI drops below", needs: "rsi", placeholder: "30" },
    { type: "rsi_above", label: "RSI rises above", needs: "rsi", placeholder: "70" },
    { type: "golden_cross", label: "Golden cross" },
    { type: "death_cross", label: "Death cross" },
    { type: "macd_bullish_cross", label: "MACD bullish cross" },
    { type: "macd_bearish_cross", label: "MACD bearish cross" },
    { type: "volume_spike", label: "Volume spike", needs: "multiple", placeholder: "2" },
  ] },
  { title: "Events", icon: "notifications-outline", types: [
    { type: "earnings_soon", label: "Earnings within 3 days" },
    { type: "new_filing", label: "New SEC filing" },
    { type: "insider_buy", label: "Insider buy" },
  ] },
];

/** Bottom sheet (centered dialog on wide screens) to create an alert for one ticker. */
export default function AlertSheet({ ticker, price, visible, onClose, onCreated }) {
  const { c } = useTheme();
  const s = useStyles();
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
      setError(e);
    }
    setBusy(false);
  }

  return (
    <Modal supportedOrientations={["portrait", "landscape"]} visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <View>
              <Text style={s.eyebrow}>New alert</Text>
              <Text style={s.title}>{ticker}{price ? <Text style={s.price}>  ${price}</Text> : null}</Text>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8} style={s.close}>
              <Ionicons name="close" size={20} color={c.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 340 }}>
            {ALERT_GROUPS.map((g) => (
              <View key={g.title}>
                <View style={s.groupHead}>
                  <Ionicons name={g.icon} size={13} color={c.muted} />
                  <Text style={s.groupTitle}>{g.title}</Text>
                </View>
                <View style={s.chips}>
                  {g.types.map((t) => (
                    <Chip key={t.type} label={t.label} active={selected.type === t.type} onPress={() => { setSelected(t); setThreshold(""); setError(null); }} />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>

          {selected.needs && (
            <View style={{ marginTop: 18 }}>
              <Text style={s.label}>{selected.needs === "price" ? "Price ($)" : selected.needs === "rsi" ? "RSI level" : "Multiple of average volume"}</Text>
              <Input keyboardType="decimal-pad" value={threshold} onChangeText={setThreshold} placeholder={selected.placeholder ?? (price ? String(price) : "")} inputStyle={{ fontSize: 18, fontWeight: "700" }} />
            </View>
          )}
          <View style={s.repeatRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Repeat</Text>
              <Text style={s.muted}>{repeat ? "Fires again after 24 hours if still true" : "Fires once, then turns off"}</Text>
            </View>
            <Switch value={repeat} onValueChange={setRepeat} trackColor={{ true: c.primary, false: c.borderStrong }} />
          </View>
          {error && (error.upgrade ? <ErrorNotice error={error} /> : <Text style={s.error}>{error.message ?? error}</Text>)}
          <Button title="Create alert" icon="notifications" onPress={save} loading={busy} size="lg" style={{ marginTop: 16 }} />
          <Text style={s.footnote}>Indicator alerts use end-of-day data. You'll get an in-app notification, plus a push on your phone if enabled.</Text>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay },
  sheet: { width: "100%", maxWidth: 560, backgroundColor: c.elevated, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, paddingBottom: 32, borderWidth: 1, borderColor: c.border },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, alignSelf: "center", marginBottom: 14 },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 },
  eyebrow: { color: c.primary, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  title: { fontSize: 22, fontWeight: "800", color: c.text, marginTop: 2 },
  price: { fontSize: 15, fontWeight: "600", color: c.muted },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16, marginBottom: 8 },
  groupTitle: { color: c.muted, fontWeight: "700", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  label: { fontWeight: "700", color: c.text, marginBottom: 6, fontSize: 14 },
  repeatRow: { flexDirection: "row", alignItems: "center", marginTop: 18 },
  muted: { color: c.muted, fontSize: 12 },
  error: { color: c.loss, marginTop: 10 },
  footnote: { color: c.muted, fontSize: 11, marginTop: 12, textAlign: "center", lineHeight: 16 },
}));
