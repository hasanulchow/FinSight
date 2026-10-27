import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LOCAL_SESSION, localMode, supabase } from "./src/lib/supabase";
import { api } from "./src/lib/api";
import { registerForPush, onNotificationTap } from "./src/lib/push";
import { makeStyles, ThemeProvider, useTheme } from "./src/theme";
import { Logo } from "./src/components/ui";
import LandingScreen from "./src/screens/LandingScreen";
import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import BriefingScreen from "./src/screens/BriefingScreen";
import StockScreen from "./src/screens/StockScreen";
import ScreenerScreen from "./src/screens/ScreenerScreen";
import PortfolioScreen from "./src/screens/PortfolioScreen";
import AlertsScreen from "./src/screens/AlertsScreen";
import MarketsScreen from "./src/screens/MarketsScreen";
import OptionsScreen from "./src/screens/OptionsScreen";
import BacktestScreen from "./src/screens/BacktestScreen";

const TABS = [
  { key: "research", label: "Research", icon: "search" },
  { key: "markets", label: "Markets", icon: "globe" },
  { key: "screener", label: "Screener", icon: "funnel" },
  { key: "portfolio", label: "Portfolio", icon: "pie-chart" },
  { key: "alerts", label: "Alerts", icon: "notifications" },
];

// Web-only preview switches: ?theme=dark|light forces a scheme, ?landing=1 shows the landing page
const params = Platform.OS === "web" && typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const forcedScheme = params?.get("theme") === "dark" ? "dark" : params?.get("theme") === "light" ? "light" : undefined;

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider scheme={forcedScheme}>
        <Shell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { c } = useTheme();
  const s = useStyles();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === "web" && width >= 960;
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [authMode, setAuthMode] = useState(params?.get("landing") === "1" ? null : Platform.OS === "web" ? null : "signin");
  const [tab, setTab] = useState("research");
  // Detail screens open on top of the current tab: { type: "briefing" | "stock" | "options" | "backtest", ... }
  const [stack, setStack] = useState([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (localMode && params?.get("landing") !== "1") return setSession(LOCAL_SESSION);
    if (localMode) return setSession(null);
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => data.subscription.unsubscribe();
  }, []);

  const push = useCallback((screen) => setStack((st) => [...st, screen]), []);
  const pop = useCallback(() => setStack((st) => st.slice(0, -1)), []);
  const openStock = useCallback((ticker) => push({ type: "stock", ticker }), [push]);
  const openBriefing = useCallback((id) => push({ type: "briefing", id }), [push]);
  const briefTicker = useCallback(async (ticker) => {
    const { id } = await api.createBriefing(ticker);
    setTab("research");
    setStack([{ type: "briefing", id }]);
  }, []);
  const goTab = (key) => {
    setTab(key);
    setStack([]);
  };

  // Once signed in: register for push, open stocks from tapped notifications, keep the unread badge fresh
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
      <View style={[s.fill, { justifyContent: "center", alignItems: "center" }]}>
        <Logo size={44} withName={false} />
        <ActivityIndicator color={c.primary} style={{ marginTop: 18 }} />
      </View>
    );
  }

  // Signed out: landing page on the web, sign-in everywhere else
  if (!session) {
    return (
      <SafeAreaView style={s.fill} edges={["top", "left", "right"]}>
        <StatusBar style={c.dark ? "light" : "dark"} />
        {authMode ? <LoginScreen initialMode={authMode} onBack={Platform.OS === "web" ? () => setAuthMode(null) : undefined} /> : <LandingScreen onStart={setAuthMode} />}
      </SafeAreaView>
    );
  }

  const top = stack[stack.length - 1];
  let screen;
  if (top?.type === "briefing") screen = <BriefingScreen key={top.id} id={top.id} onBack={pop} onOpenStock={openStock} />;
  else if (top?.type === "stock") {
    screen = (
      <StockScreen
        key={top.ticker}
        ticker={top.ticker}
        onBack={pop}
        onBrief={briefTicker}
        onOptions={(t) => push({ type: "options", ticker: t })}
        onBacktest={(t) => push({ type: "backtest", ticker: t })}
      />
    );
  } else if (top?.type === "options") screen = <OptionsScreen key={`o-${top.ticker}`} ticker={top.ticker} onBack={pop} />;
  else if (top?.type === "backtest") screen = <BacktestScreen key={`b-${top.ticker}`} ticker={top.ticker} onBack={pop} />;
  else if (tab === "markets") screen = <MarketsScreen onOpenStock={openStock} />;
  else if (tab === "screener") screen = <ScreenerScreen onOpenStock={openStock} />;
  else if (tab === "portfolio") screen = <PortfolioScreen onOpenStock={openStock} />;
  else if (tab === "alerts") screen = <AlertsScreen onOpenStock={openStock} onUnreadChange={setUnread} />;
  else screen = <HomeScreen email={session.user.email} onOpen={openBriefing} onOpenStock={openStock} showSignOut={!wide} />;

  const content = (
    <View style={s.contentOuter}>
      <View style={[s.content, wide && s.contentWide]}>{screen}</View>
    </View>
  );

  if (wide) {
    return (
      <View style={[s.fill, { flexDirection: "row" }]}>
        <StatusBar style={c.dark ? "light" : "dark"} />
        <View style={s.sidebar}>
          <View style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
            <Logo size={34} />
          </View>
          <View style={{ marginTop: 26, gap: 4 }}>
            {TABS.map((t) => {
              const active = tab === t.key && !stack.length;
              const inSection = tab === t.key;
              return (
                <Pressable key={t.key} onPress={() => goTab(t.key)} style={({ hovered }) => [s.navItem, (active || inSection) && s.navActive, hovered && !inSection && s.navHover]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                  <Ionicons name={inSection ? t.icon : `${t.icon}-outline`} size={19} color={inSection ? c.primary : c.textSecondary} />
                  <Text style={[s.navText, inSection && { color: c.text }]}>{t.label}</Text>
                  {t.key === "alerts" && unread > 0 && <View style={s.navBadge}><Text style={s.badgeText}>{unread > 9 ? "9+" : unread}</Text></View>}
                </Pressable>
              );
            })}
          </View>
          <View style={{ flex: 1 }} />
          <View style={s.account}>
            <View style={s.avatar}><Text style={s.avatarText}>{(session.user.email ?? "?").slice(0, 1).toUpperCase()}</Text></View>
            <Text style={s.accountEmail} numberOfLines={1}>{session.user.email}</Text>
            {!localMode && (
              <Pressable onPress={() => supabase.auth.signOut()} accessibilityLabel="Sign out" hitSlop={8}>
                <Ionicons name="log-out-outline" size={19} color={c.muted} />
              </Pressable>
            )}
          </View>
        </View>
        {content}
      </View>
    );
  }

  return (
    <SafeAreaView style={s.fill} edges={["top", "left", "right"]}>
      <StatusBar style={c.dark ? "light" : "dark"} />
      {content}
      <SafeAreaView edges={["bottom"]} style={s.tabBar}>
        {TABS.map((t) => {
          const inSection = tab === t.key;
          return (
            <Pressable key={t.key} style={s.tab} onPress={() => goTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: inSection }} accessibilityLabel={t.label}>
              <View style={[s.tabIconWrap, inSection && { backgroundColor: c.primarySoft }]}>
                <Ionicons name={inSection ? t.icon : `${t.icon}-outline`} size={21} color={inSection ? c.primary : c.muted} />
                {t.key === "alerts" && unread > 0 && <View style={s.badge}><Text style={s.badgeText}>{unread > 9 ? "9+" : unread}</Text></View>}
              </View>
              <Text style={[s.tabLabel, inSection && { color: c.primary }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  fill: { flex: 1, backgroundColor: c.bg },
  contentOuter: { flex: 1, backgroundColor: c.bg },
  content: { flex: 1, width: "100%", alignSelf: "center" },
  contentWide: { maxWidth: 1040, paddingHorizontal: 12 },
  sidebar: { width: 248, backgroundColor: c.surface, borderRightWidth: 1, borderRightColor: c.border, padding: 16, paddingTop: 22 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12 },
  navActive: { backgroundColor: c.primarySoft },
  navHover: { backgroundColor: c.surfaceAlt },
  navText: { color: c.textSecondary, fontWeight: "600", fontSize: 15, flex: 1 },
  navBadge: { backgroundColor: c.loss, borderRadius: 9, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  account: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, backgroundColor: c.surfaceAlt },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: c.primary, fontWeight: "800" },
  accountEmail: { flex: 1, color: c.textSecondary, fontSize: 13 },
  tabBar: { flexDirection: "row", backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 6 },
  tab: { flex: 1, alignItems: "center", paddingBottom: 6, gap: 2 },
  tabIconWrap: { width: 46, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  tabLabel: { fontSize: 11, fontWeight: "600", color: c.muted },
  badge: { position: "absolute", top: -2, right: 2, backgroundColor: c.loss, borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 2, borderColor: c.surface },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
}));
