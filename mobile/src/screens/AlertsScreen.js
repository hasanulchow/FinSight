import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { colors } from "../theme";
import { TickerAvatar } from "../components/ui";
import AlertSheet, { ALERT_GROUPS } from "../components/AlertSheet";

const LABELS = Object.fromEntries(ALERT_GROUPS.flatMap((g) => g.types.map((t) => [t.type, t.label])));
const KIND_ICON = { alert: { icon: "notifications", color: colors.primary }, digest: { icon: "newspaper", color: "#7C3AED" } };

const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

/** Alerts tab: notification inbox + manage alerts. */
export default function AlertsScreen({ onOpenStock, onUnreadChange }) {
  const [tab, setTab] = useState("inbox");
  const [notifications, setNotifications] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [sheetTicker, setSheetTicker] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [n, a] = await Promise.all([api.notifications(), api.alerts()]);
      setNotifications(n);
      setAlerts(a);
      onUnreadChange?.(n.filter((x) => !x.read).length);
    } catch (e) {
      setError(e.message);
    }
    setRefreshing(false);
  }, [onUnreadChange]);

  useEffect(() => {
    load();
  }, [load]);

  async function openNotification(n) {
    if (!n.read) {
      api.markRead(n.id).catch(() => {});
      const next = notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x));
      setNotifications(next);
      onUnreadChange?.(next.filter((x) => !x.read).length);
    }
    if (n.ticker) onOpenStock(n.ticker);
  }

  async function toggle(alert) {
    setAlerts((list) => list.map((a) => (a.id === alert.id ? { ...a, active: !a.active } : a)));
    await api.updateAlert(alert.id, { active: !alert.active }).catch((e) => setError(e.message));
  }

  async function remove(alert) {
    setAlerts((list) => list.filter((a) => a.id !== alert.id));
    await api.deleteAlert(alert.id).catch((e) => setError(e.message));
  }

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.primary} />}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Alerts</Text>
        <Text style={styles.heroSub}>Price, indicator and event alerts, each explained by AI when it fires.</Text>
        <View style={styles.segment}>
          {[["inbox", `Inbox${unread ? ` (${unread})` : ""}`], ["manage", `My alerts (${alerts.filter((a) => a.active).length})`]].map(([key, label]) => (
            <Pressable key={key} style={[styles.segmentItem, tab === key && styles.segmentActive]} onPress={() => setTab(key)}>
              <Text style={[styles.segmentText, tab === key && { color: "#B45309" }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ padding: 16 }}>
        {error && <Text style={styles.error}>{error}</Text>}

        {tab === "inbox" && (
          <>
            {unread > 0 && (
              <Pressable onPress={() => api.markRead("all").then(load)} style={{ alignSelf: "flex-end" }}>
                <Text style={styles.link}>Mark all as read</Text>
              </Pressable>
            )}
            {notifications.length === 0 && !refreshing && (
              <View style={styles.empty}>
                <Ionicons name="notifications-off-outline" size={36} color="#D97706" />
                <Text style={styles.emptyTitle}>No notifications yet</Text>
                <Text style={styles.emptyText}>Create an alert and you'll see it here when it fires. Portfolio digests arrive here too.</Text>
              </View>
            )}
            {notifications.map((n) => {
              const k = KIND_ICON[n.kind] ?? KIND_ICON.alert;
              return (
                <Pressable key={n.id} style={[styles.note, !n.read && styles.noteUnread]} onPress={() => openNotification(n)}>
                  <View style={[styles.noteIcon, { backgroundColor: `${k.color}1A` }]}>
                    <Ionicons name={k.icon} size={18} color={k.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.noteTop}>
                      <Text style={styles.noteTitle} numberOfLines={1}>{n.title}</Text>
                      <Text style={styles.time}>{timeAgo(n.created_at)}</Text>
                    </View>
                    <Text style={styles.noteBody}>{n.body}</Text>
                  </View>
                  {!n.read && <View style={styles.unreadDot} />}
                </Pressable>
              );
            })}
          </>
        )}

        {tab === "manage" && (
          <>
            <View style={styles.newRow}>
              <TextInput
                style={styles.newInput}
                placeholder="Ticker for a new alert, e.g. TSLA"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                value={newTicker}
                onChangeText={setNewTicker}
                onSubmitEditing={() => newTicker.trim() && setSheetTicker(newTicker.trim().toUpperCase())}
              />
              <Pressable style={styles.newButton} onPress={() => newTicker.trim() && setSheetTicker(newTicker.trim().toUpperCase())} accessibilityLabel="New alert">
                <Ionicons name="add" size={22} color={colors.white} />
              </Pressable>
            </View>
            {alerts.length === 0 && !refreshing && <Text style={styles.emptyText}>No alerts yet. Add one above or from any stock's page.</Text>}
            {alerts.map((a) => (
              <View key={a.id} style={[styles.alertRow, !a.active && { opacity: 0.55 }]}>
                <Pressable onPress={() => onOpenStock(a.ticker)}>
                  <TickerAvatar ticker={a.ticker} size={40} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertTitle}>{a.ticker} · {LABELS[a.type] ?? a.type}{a.threshold != null ? ` ${a.threshold}` : ""}</Text>
                  <Text style={styles.time}>
                    {a.repeat ? "Repeats" : "Once"}
                    {a.last_triggered_at ? ` · last fired ${timeAgo(a.last_triggered_at)}` : " · not fired yet"}
                  </Text>
                </View>
                <Switch value={a.active} onValueChange={() => toggle(a)} trackColor={{ true: colors.primary }} />
                <Pressable onPress={() => remove(a)} hitSlop={10} accessibilityLabel="Delete alert">
                  <Ionicons name="trash-outline" size={18} color={colors.muted} />
                </Pressable>
              </View>
            ))}
          </>
        )}
      </View>

      {sheetTicker && (
        <AlertSheet
          ticker={sheetTicker}
          visible
          onClose={() => setSheetTicker(null)}
          onCreated={() => {
            setNewTicker("");
            load();
          }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: "#D97706", padding: 20, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroTitle: { color: colors.white, fontSize: 26, fontWeight: "800" },
  heroSub: { color: "#FEF3C7", fontSize: 14, marginTop: 6 },
  segment: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 12, padding: 4, marginTop: 16 },
  segmentItem: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
  segmentActive: { backgroundColor: colors.white },
  segmentText: { color: colors.white, fontWeight: "700" },
  error: { color: colors.red, marginBottom: 10 },
  link: { color: colors.primary, fontWeight: "700", marginBottom: 6 },
  empty: { alignItems: "center", padding: 28, backgroundColor: colors.card, borderRadius: 20 },
  emptyTitle: { fontWeight: "800", fontSize: 16, color: colors.text, marginTop: 10 },
  emptyText: { color: colors.muted, textAlign: "center", marginTop: 6, lineHeight: 20 },
  note: { flexDirection: "row", gap: 12, backgroundColor: colors.card, borderRadius: 16, padding: 12, marginTop: 10, alignItems: "flex-start" },
  noteUnread: { borderWidth: 1.5, borderColor: colors.primarySoft },
  noteIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  noteTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  noteTitle: { fontWeight: "800", color: colors.text, flex: 1 },
  noteBody: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 4 },
  time: { color: colors.muted, fontSize: 12 },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 },
  newRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  newInput: { flex: 1, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: "700", color: colors.text },
  newButton: { width: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  alertRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderRadius: 16, padding: 12, marginTop: 10 },
  alertTitle: { fontWeight: "800", color: colors.text },
});
