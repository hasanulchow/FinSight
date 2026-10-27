import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LOCAL_SESSION, localMode, supabase } from "./src/lib/supabase";
import { api } from "./src/lib/api";
import { registerForPush, onNotificationTap } from "./src/lib/push";
import { colors } from "./src/theme";
import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import BriefingScreen from "./src/screens/BriefingScreen";
import StockScreen from "./src/screens/StockScreen";
import ScreenerScreen from "./src/screens/ScreenerScreen";
import PortfolioScreen from "./src/screens/PortfolioScreen";
import AlertsScreen from "./src/screens/AlertsScreen";

const TABS = [
  { key: "research", label: "Research", icon: "search" },
  { key: "screener", label: "Screener", icon: "funnel" },
  { key: "portfolio", label: "Portfolio", icon: "pie-chart" },
  { key: "alerts", label: "Alerts", icon: "notifications" },
];

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [tab, setTab] = useState("research");
  // Detail screens open on top of the current tab: { type: "briefing", id } | { type: "stock", ticker }
  const [stack, setStack] = useState([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (localMode) return setSession(LOCAL_SESSION);
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const push = useCallback((screen) => setStack((s) => [...s, screen]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const openStock = useCallback((ticker) => push({ type: "stock", ticker }), [push]);
  const openBriefing = useCallback((id) => push({ type: "briefing", id }), [push]);
  const briefTicker = useCallback(async (ticker) => {
    const { id } = await api.createBriefing(ticker);
    setTab("research");
    setStack([{ type: "briefing", id }]);
  }, []);

  // Once signed in: register for push, open stocks from tapped notifications, and keep the unread badge fresh
  useEffect(() => {
    if (!session) return;
    registerForPush();
    const unsubscribe = onNotificationTap((ticker) => {
      setTab("alerts");
      setStack([{ type: "stock", ticker }]);
    });
    const refresh = () => api.notifications().then((n) => setUnread(n.filter((x) => !x.read).length)).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 120_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [session]);

  if (session === undefined) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  let screen;
  const top = stack[stack.length - 1];
  if (!session) screen = <LoginScreen />;
  else if (top?.type === "briefing") screen = <BriefingScreen key={top.id} id={top.id} onBack={pop} onOpenStock={openStock} />;
  else if (top?.type === "stock") screen = <StockScreen key={top.ticker} ticker={top.ticker} onBack={pop} onBrief={briefTicker} />;
  else if (tab === "screener") screen = <ScreenerScreen onOpenStock={openStock} />;
  else if (tab === "portfolio") screen = <PortfolioScreen onOpenStock={openStock} />;
  else if (tab === "alerts") screen = <AlertsScreen onOpenStock={openStock} onUnreadChange={setUnread} />;
  else screen = <HomeScreen email={session.user.email} onOpen={openBriefing} onOpenStock={openStock} />;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "left", "right"]}>
        <StatusBar style="dark" />
        <View style={{ flex: 1 }}>{screen}</View>
        {session && (
          <SafeAreaView edges={["bottom"]} style={styles.tabBar}>
            {TABS.map((t) => {
              const active = tab === t.key && !stack.length;
              return (
                <Pressable
                  key={t.key}
                  style={styles.tab}
                  onPress={() => {
                    setTab(t.key);
                    setStack([]);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t.label}
                >
                  <View>
                    <Ionicons name={active ? t.icon : `${t.icon}-outline`} size={23} color={active ? colors.primary : colors.muted} />
                    {t.key === "alerts" && unread > 0 && (
                      <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text></View>
                    )}
                  </View>
                  <Text style={[styles.tabLabel, active && { color: colors.primary }]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </SafeAreaView>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: { flexDirection: "row", backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 },
  tab: { flex: 1, alignItems: "center", paddingBottom: 6, gap: 2 },
  tabLabel: { fontSize: 11, fontWeight: "700", color: colors.muted },
  badge: { position: "absolute", top: -4, right: -10, backgroundColor: colors.red, borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: "800" },
});
