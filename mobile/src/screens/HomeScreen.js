import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { localMode, supabase } from "../lib/supabase";
import { makeStyles, scoreLabel, useTheme } from "../theme";
import { Banner, Button, Chip, EmptyState, IconButton, Input, PageHeader, TickerAvatar } from "../components/ui";

const POPULAR = ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "JPM", "META", "GOOGL"];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function HomeScreen({ email, onOpen, onOpenStock, showSignOut = true }) {
  const { c } = useTheme();
  const s = useStyles();
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

  const openChart = (symbol = ticker) => {
    const clean = symbol.trim().toUpperCase();
    if (!clean) return setError("Type a ticker symbol, like AAPL.");
    onOpenStock(clean);
  };

  const header = (
    <View>
      <PageHeader
        eyebrow={`${greeting()}${email && !localMode ? ` · ${email.split("@")[0]}` : ""}`}
        title="What are you researching today?"
        right={showSignOut && !localMode ? <IconButton icon="log-out-outline" label="Sign out" onPress={() => supabase.auth.signOut()} /> : null}
      />

      <View style={s.searchCard}>
        <Input
          icon="search"
          placeholder="Enter a ticker, like NVDA"
          autoCapitalize="characters"
          autoCorrect={false}
          value={ticker}
          onChangeText={(t) => { setTicker(t); setError(null); }}
          onSubmitEditing={() => generate()}
          returnKeyType="go"
          inputStyle={s.searchInput}
        />
        {error && <Banner tone="error">{error}</Banner>}
        <View style={s.actions}>
          <Button title="Full AI briefing" icon="sparkles" onPress={() => generate()} loading={starting} style={{ flex: 1 }} size="lg" />
          <Button title="Chart" icon="stats-chart" variant="secondary" onPress={() => openChart()} size="lg" />
        </View>
        <Text style={s.chipsLabel}>Popular</Text>
        <View style={s.chips}>
          {POPULAR.map((t) => <Chip key={t} label={t} onPress={() => openChart(t)} />)}
        </View>
      </View>

      <View style={s.how}>
        {[["git-network-outline", "8 AI agents", "work in parallel"], ["document-text-outline", "SEC filings", "with citations"], ["shield-checkmark-outline", "Reviewed", "and quality-scored"]].map(([icon, a, b]) => (
          <View key={a} style={s.howItem}>
            <Ionicons name={icon} size={18} color={c.primary} />
            <View>
              <Text style={s.howTitle} numberOfLines={1}>{a}</Text>
              <Text style={s.howText} numberOfLines={2}>{b}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={s.section}>Your briefings</Text>
    </View>
  );

  return (
    <FlatList
      data={history}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      contentContainerStyle={s.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={c.primary} />}
      ListEmptyComponent={!refreshing && <EmptyState icon="newspaper-outline" title="Start your first briefing" text="Enter a ticker above or tap a popular stock to see its chart." />}
      renderItem={({ item }) => <HistoryItem item={item} onPress={() => onOpen(item.id)} />}
    />
  );
}

function HistoryItem({ item, onPress }) {
  const theme = useTheme();
  const { c } = theme;
  const s = useStyles();
  const score = item.evaluations?.[0]?.overall;
  let badge;
  if (item.status === "running") badge = { text: "In progress", color: c.primary, icon: "time-outline" };
  else if (item.status === "failed") badge = { text: "Failed", color: c.loss, icon: "close-circle-outline" };
  else if (score != null) badge = { text: `${Number(score).toFixed(1)} · ${scoreLabel(score)}`, color: theme.scoreColor(score), icon: "star" };

  return (
    <Pressable style={({ pressed, hovered }) => [s.item, hovered && { borderColor: c.borderStrong }, pressed && { opacity: 0.85 }]} onPress={onPress}>
      <TickerAvatar ticker={item.ticker} />
      <View style={{ flex: 1 }}>
        <Text style={s.itemTitle} numberOfLines={1}>{item.company_name || item.ticker}</Text>
        <Text style={s.itemSub}>{item.ticker} · {new Date(item.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Text>
      </View>
      {badge && (
        <View style={[s.badge, { backgroundColor: c.soft(badge.color) }]}>
          <Ionicons name={badge.icon} size={12} color={badge.color} />
          <Text style={[s.badgeText, { color: badge.color }]}>{badge.text}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={c.muted} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  list: { padding: 16, paddingBottom: 40 },
  searchCard: { backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 16 },
  searchInput: { fontSize: 18, fontWeight: "700", paddingVertical: 15 },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  chipsLabel: { color: c.muted, fontSize: 11, fontWeight: "700", marginTop: 16, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  how: { flexDirection: "row", gap: 8, marginTop: 12 },
  // Icon above text so three tiles fit side by side even at phone width
  howItem: { flex: 1, gap: 8, backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 12, minWidth: 0 },
  howTitle: { color: c.text, fontWeight: "700", fontSize: 13 },
  howText: { color: c.muted, fontSize: 11, marginTop: 1 },
  section: { fontWeight: "800", fontSize: 18, color: c.text, marginTop: 26, marginBottom: 4, letterSpacing: -0.2 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.border, padding: 12, marginTop: 10 },
  itemTitle: { fontWeight: "700", fontSize: 15, color: c.text },
  itemSub: { color: c.muted, fontSize: 13, marginTop: 2 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: "700" },
}));
