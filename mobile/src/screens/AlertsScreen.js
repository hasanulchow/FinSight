import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Banner, Button, EmptyState, Input, PageHeader, Segmented, TickerAvatar } from "../components/ui";
import AlertSheet, { ALERT_GROUPS } from "../components/AlertSheet";

const LABELS = Object.fromEntries(ALERT_GROUPS.flatMap((g) => g.types.map((t) => [t.type, t.label])));

const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

/** Alerts tab: notification inbox + manage alerts. */
export default function AlertsScreen({ onOpenStock, onUnreadChange }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [tab, setTab] = useState("inbox");
  const [notifications, setNotifications] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [sheetTicker, setSheetTicker] = useState(null);
  const [error, setError] = useState(null);
  const KIND = { alert: { icon: "notifications", color: sections.alerts.color }, digest: { icon: "newspaper", color: sections.portfolio.color } };

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
  const active = alerts.filter((a) => a.active).length;
  const openSheet = () => newTicker.trim() && setSheetTicker(newTicker.trim().toUpperCase());

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={c.primary} />}>
      <PageHeader eyebrow="Alerts" title="Stay ahead of every move" subtitle="Price, indicator and event alerts, each explained by AI when it fires." />
      <Segmented options={[["inbox", `Inbox${unread ? ` · ${unread}` : ""}`], ["manage", `My alerts · ${active}`]]} value={tab} onChange={setTab} />
      {error && <Banner tone="error">{error}</Banner>}

      {tab === "inbox" && (
        <View style={{ marginTop: 8 }}>
          {unread > 0 && (
            <Pressable onPress={() => api.markRead("all").then(load)} style={s.markAll}>
              <Ionicons name="checkmark-done" size={15} color={c.primary} />
              <Text style={s.link}>Mark all as read</Text>
            </Pressable>
          )}
          {notifications.length === 0 && !refreshing && (
            <EmptyState icon="notifications-off-outline" title="No notifications yet" text="Create an alert and it appears here when it fires. Daily portfolio digests arrive here too." action={<Button title="Create an alert" icon="add" variant="secondary" onPress={() => setTab("manage")} />} />
          )}
          {notifications.map((n) => {
            const k = KIND[n.kind] ?? KIND.alert;
            return (
              <Pressable key={n.id} style={({ hovered }) => [s.note, !n.read && s.noteUnread, hovered && { borderColor: c.borderStrong }]} onPress={() => openNotification(n)}>
                <View style={[s.noteIcon, { backgroundColor: c.soft(k.color) }]}>
                  <Ionicons name={k.icon} size={17} color={k.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.noteTop}>
                    <Text style={[s.noteTitle, !n.read && { color: c.text }]} numberOfLines={1}>{n.title}</Text>
                    <Text style={s.time}>{timeAgo(n.created_at)}</Text>
                  </View>
                  <Text style={s.noteBody}>{n.body}</Text>
                </View>
                {!n.read && <View style={s.unreadDot} />}
              </Pressable>
            );
          })}
        </View>
      )}

      {tab === "manage" && (
        <View style={{ marginTop: 14 }}>
          <View style={s.newRow}>
            <Input
              style={{ flex: 1 }}
              icon="add-circle-outline"
              placeholder="Ticker for a new alert, e.g. TSLA"
              autoCapitalize="characters"
              autoCorrect={false}
              value={newTicker}
              onChangeText={setNewTicker}
              onSubmitEditing={openSheet}
            />
            <Button title="New alert" onPress={openSheet} disabled={!newTicker.trim()} />
          </View>
          {alerts.length === 0 && !refreshing && <EmptyState icon="pulse-outline" title="No alerts yet" text="Add one above, or tap the Alert button on any stock page." />}
          {alerts.map((a) => (
            <View key={a.id} style={[s.alertRow, !a.active && { opacity: 0.55 }]}>
              <Pressable onPress={() => onOpenStock(a.ticker)}>
                <TickerAvatar ticker={a.ticker} size={42} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={s.alertTitle}>{a.ticker} · {LABELS[a.type] ?? a.type}{a.threshold != null ? ` ${a.threshold}` : ""}</Text>
                <Text style={s.time}>{a.repeat ? "Repeats" : "Once"}{a.last_triggered_at ? ` · last fired ${timeAgo(a.last_triggered_at)}` : " · not fired yet"}</Text>
              </View>
              <Switch value={a.active} onValueChange={() => toggle(a)} trackColor={{ true: c.primary, false: c.borderStrong }} />
              <Pressable onPress={() => remove(a)} hitSlop={10} accessibilityLabel="Delete alert" style={s.remove}>
                <Ionicons name="trash-outline" size={17} color={c.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

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

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  markAll: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", paddingVertical: 8 },
  link: { color: c.primary, fontWeight: "700", fontSize: 13 },
  note: { flexDirection: "row", gap: 12, backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.border, padding: 14, marginTop: 10, alignItems: "flex-start" },
  noteUnread: { borderColor: c.primarySoft, backgroundColor: c.elevated },
  noteIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  noteTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  noteTitle: { fontWeight: "700", color: c.textSecondary, flex: 1, fontSize: 15 },
  noteBody: { color: c.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4 },
  time: { color: c.muted, fontSize: 12, marginTop: 1 },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.primary, marginTop: 6 },
  newRow: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 4 },
  alertRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.border, padding: 12, marginTop: 10 },
  alertTitle: { fontWeight: "700", color: c.text, fontSize: 14 },
  remove: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
}));
