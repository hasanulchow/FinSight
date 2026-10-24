import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import { colors, scoreColor, scoreLabel } from "../theme";
import { PrimaryButton, TickerAvatar } from "../components/ui";

const POPULAR = ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "JPM"];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function HomeScreen({ email, onOpen }) {
  const [ticker, setTicker] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setHistory(await api.listBriefings());
    } catch (e) {
      setError(e.message);
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generate(symbol = ticker) {
    const clean = symbol.trim().toUpperCase();
    if (!clean) return setError("Type a ticker symbol, like AAPL.");
    setStarting(true);
    setError(null);
    try {
      const { id } = await api.createBriefing(clean);
      setTicker("");
      onOpen(id);
    } catch (e) {
      setError(e.message);
    }
    setStarting(false);
  }

  const header = (
    <View>
      <View style={styles.hero}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{greeting()} 👋</Text>
            <Text style={styles.email} numberOfLines={1}>{email}</Text>
          </View>
          <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()} accessibilityLabel="Sign out">
            <Ionicons name="log-out-outline" size={20} color={colors.white} />
          </Pressable>
        </View>
        <Text style={styles.heroTitle}>Which stock are you discussing today?</Text>
      </View>

      <View style={styles.searchCard}>
        <View style={styles.inputRow}>
          <Ionicons name="search" size={20} color={colors.primary} />
          <TextInput
            style={styles.input}
            placeholder="Enter a ticker, like AAPL"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            value={ticker}
            onChangeText={(t) => { setTicker(t); setError(null); }}
            onSubmitEditing={() => generate()}
            returnKeyType="go"
          />
        </View>
        {error && (
          <View style={styles.error}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.red} />
            <Text style={{ color: colors.red, flex: 1 }}>{error}</Text>
          </View>
        )}
        <PrimaryButton title="Create briefing" icon="sparkles" onPress={() => generate()} loading={starting} style={{ marginTop: 12 }} />

        <Text style={styles.chipsLabel}>Popular</Text>
        <View style={styles.chips}>
          {POPULAR.map((t) => (
            <Pressable key={t} style={({ pressed }) => [styles.chip, pressed && { backgroundColor: colors.primarySoft }]} onPress={() => generate(t)} disabled={starting}>
              <Text style={styles.chipText}>{t}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.howItWorks}>
        <Ionicons name="people-outline" size={18} color={colors.primary} />
        <Text style={styles.howText}>7 AI agents read the live quote, SEC financials and the latest 10-K, then a reviewer checks it for compliance.</Text>
      </View>

      <Text style={styles.section}>Your briefings</Text>
    </View>
  );

  return (
    <FlatList
      data={history}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.primary} />}
      ListEmptyComponent={
        !refreshing && (
          <View style={styles.empty}>
            <Ionicons name="newspaper-outline" size={36} color={colors.primary} />
            <Text style={styles.emptyTitle}>Start your first briefing</Text>
            <Text style={styles.emptyText}>Enter a ticker above or tap a popular stock.</Text>
          </View>
        )
      }
      renderItem={({ item }) => <HistoryItem item={item} onPress={() => onOpen(item.id)} />}
    />
  );
}

function HistoryItem({ item, onPress }) {
  const score = item.evaluations?.[0]?.overall;
  let badge;
  if (item.status === "running") badge = { text: "In progress", color: colors.primary, soft: colors.primarySoft, icon: "time-outline" };
  else if (item.status === "failed") badge = { text: "Failed", color: colors.red, soft: colors.redSoft, icon: "close-circle-outline" };
  else if (score != null) {
    const c = scoreColor(score);
    badge = { text: `${Number(score).toFixed(1)} · ${scoreLabel(score)}`, color: c, soft: `${c}1A`, icon: "star" };
  }

  return (
    <Pressable style={({ pressed }) => [styles.item, pressed && { transform: [{ scale: 0.99 }], opacity: 0.9 }]} onPress={onPress}>
      <TickerAvatar ticker={item.ticker} />
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle} numberOfLines={1}>{item.company_name || item.ticker}</Text>
        <Text style={styles.itemSub}>{item.ticker} · {new Date(item.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Text>
      </View>
      {badge && (
        <View style={[styles.badge, { backgroundColor: badge.soft }]}>
          <Ionicons name={badge.icon} size={12} color={badge.color} />
          <Text style={[styles.badgeText, { color: badge.color }]}>{badge.text}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.primary, padding: 20, paddingBottom: 70, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  topRow: { flexDirection: "row", alignItems: "center" },
  greeting: { color: colors.white, fontSize: 20, fontWeight: "800" },
  email: { color: "#C7D2FE", fontSize: 13, marginTop: 2 },
  signOut: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  heroTitle: { color: colors.white, fontSize: 24, fontWeight: "800", marginTop: 22, lineHeight: 30 },
  searchCard: { backgroundColor: colors.card, marginHorizontal: 16, marginTop: -48, borderRadius: 22, padding: 16, shadowColor: "#1E1B4B", shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderColor: colors.primarySoft, backgroundColor: "#FAFAFF", borderRadius: 14, paddingHorizontal: 14 },
  input: { flex: 1, paddingVertical: 14, fontSize: 18, fontWeight: "700", color: colors.text },
  error: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: colors.redSoft, borderRadius: 10, padding: 10, marginTop: 10 },
  chipsLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 16, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1.5, borderColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { color: colors.primary, fontWeight: "700" },
  howItWorks: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: colors.primarySoft, marginHorizontal: 16, marginTop: 14, borderRadius: 14, padding: 12 },
  howText: { flex: 1, color: colors.primaryDark, fontSize: 13, lineHeight: 18 },
  section: { fontWeight: "800", fontSize: 18, color: colors.text, marginTop: 24, marginBottom: 6, marginHorizontal: 16 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderRadius: 18, padding: 12, marginHorizontal: 16, marginTop: 10, shadowColor: "#1E1B4B", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  itemTitle: { fontWeight: "700", fontSize: 15, color: colors.text },
  itemSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", padding: 30, margin: 16, backgroundColor: colors.card, borderRadius: 18 },
  emptyTitle: { fontWeight: "800", fontSize: 16, color: colors.text, marginTop: 10 },
  emptyText: { color: colors.muted, marginTop: 4, textAlign: "center" },
});
