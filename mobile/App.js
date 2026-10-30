import { useCallback, useEffect, useState } from "react";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from "@expo-google-fonts/inter";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LOCAL_SESSION, localMode, supabase } from "./src/lib/supabase";
import { api } from "./src/lib/api";
import { registerForPush, onNotificationTap } from "./src/lib/push";
import { rememberRef } from "./src/lib/share";
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
import CopilotScreen from "./src/screens/CopilotScreen";
import JournalScreen from "./src/screens/JournalScreen";
import AccountScreen from "./src/screens/AccountScreen";
import MoreScreen from "./src/screens/MoreScreen";
import TodayScreen from "./src/screens/TodayScreen";
import AutomationsScreen from "./src/screens/AutomationsScreen";
import TaxScreen from "./src/screens/TaxScreen";
import AdminScreen from "./src/screens/AdminScreen";
import LegalScreen from "./src/screens/LegalScreen";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import ShareScreen from "./src/screens/ShareScreen";
import TradeScreen from "./src/screens/TradeScreen";
import { UpgradeContext } from "./src/components/Upgrade";
import NavIcon from "./src/components/NavIcon";

// The sidebar (tablets and desktop) shows every section; the phone tab bar shows the first four plus "More"
const SECTIONS = [
  { key: "today", label: "Today", icon: "sunny" },
  { key: "copilot", label: "Copilot", icon: "sparkles" },
  { key: "trade", label: "Trade", icon: "swap-vertical" },
  { key: "portfolio", label: "Portfolio", icon: "pie-chart" },
  { key: "research", label: "Research", icon: "search", section: "summary", sub: "AI briefings from SEC filings" },
  { key: "markets", label: "Markets", icon: "globe", section: "markets", sub: "Indexes, sectors, movers and heatmap" },
  { key: "journal", label: "Journal", icon: "journal", section: "journal", sub: "Trades, stats, rules and AI coach" },
  { key: "screener", label: "Screener", icon: "funnel", section: "screener", sub: "Find stocks in plain English" },
  { key: "alerts", label: "Alerts", icon: "notifications", section: "alerts", sub: "Price, indicator and earnings alerts" },
  { key: "tax", label: "Tax center", icon: "receipt", section: "redflags", sub: "Realized gains, wash sales, harvesting" },
  { key: "account", label: "Account", icon: "person-circle", section: "account", sub: "Plan, invites, settings and privacy" },
];
const GROUPS = [
  ["Home", ["today", "copilot", "trade", "portfolio"]],
  ["Research", ["research", "markets", "screener", "journal"]],
  ["Account", ["alerts", "tax", "account", "admin"]],
];
const ADMIN = { key: "admin", label: "Admin", icon: "stats-chart", section: "benchmark", sub: "Users, revenue and AI cost" };
const PHONE_TABS = [...SECTIONS.slice(0, 4), { key: "more", label: "More", icon: "grid" }];

// Web-only URL switches: ?theme=dark|light, ?landing=1 (landing page), ?share=TOKEN (public share), ?legal=terms|privacy|disclaimer
const params = Platform.OS === "web" && typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const forcedScheme = params?.get("theme") === "dark" ? "dark" : params?.get("theme") === "light" ? "light" : undefined;

export default function App() {
  // Inter for all text. Render once loaded (or after 3s, falling back to the system font if a load fails)
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);
  if (!fontsLoaded && !fontError && !timedOut) return null;
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
  // Tablets (iPad, Android tablets) and desktop browsers get the sidebar layout
  const wide = width >= 768;
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [authMode, setAuthMode] = useState(params?.get("landing") === "1" ? null : Platform.OS === "web" ? null : "signin");
  const [tab, setTab] = useState("today");
  // Detail screens open on top of the current tab: { type: "briefing" | "stock" | "options" | "backtest" | "automations" | "legal", ... }
  const [stack, setStack] = useState([]);
  const [unread, setUnread] = useState(0);
  const [settings, setSettings] = useState(null);
  const [publicView, setPublicView] = useState(params?.get("share") ? { type: "share", token: params.get("share") } : params?.get("legal") ? { type: "legal", doc: params.get("legal") } : null);
  const [onboardingLegal, setOnboardingLegal] = useState(null);

  useEffect(() => {
    rememberRef();
    if (localMode && params?.get("landing") !== "1") return setSession(LOCAL_SESSION);
    if (localMode) return setSession(null);
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => data.subscription.unsubscribe();
  }, []);

  const push = useCallback((screen) => setStack((st) => [...st, screen]), []);
  const pop = useCallback(() => setStack((st) => st.slice(0, -1)), []);
  const openStock = useCallback((ticker) => push({ type: "stock", ticker }), [push]);
  const goTab = useCallback((key) => {
    setTab(key);
    setStack([]);
  }, []);
  const openAccount = useCallback(() => {
    api.track("upgrade_viewed");
    goTab("account");
  }, [goTab]);
  const openBriefing = useCallback((id) => push({ type: "briefing", id }), [push]);
  const openLegal = useCallback((doc) => push({ type: "legal", doc }), [push]);
  const briefTicker = useCallback(async (ticker) => {
    const { id } = await api.createBriefing(ticker);
    setTab("research");
    setStack([{ type: "briefing", id }]);
  }, []);

  // Once signed in: load settings (onboarding gate), register for push, keep the unread badge fresh
  useEffect(() => {
    if (!session) return;
    api.settings().then(setSettings).catch(() => setSettings({ needs_onboarding: false }));
    registerForPush();
    const unsubscribe = onNotificationTap((ticker) => {
      setTab(ticker ? "alerts" : "today");
      setStack(ticker ? [{ type: "stock", ticker }] : []);
    });
    const refresh = () => api.notifications().then((n) => setUnread(n.filter((x) => !x.read).length)).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 120_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [session]);

  // Public pages (web links), shown whether or not the visitor is signed in
  if (publicView) {
    const signUp = () => {
      setPublicView(null);
      if (typeof window !== "undefined") window.history.replaceState(null, "", window.location.pathname);
      if (!session) setAuthMode("signup");
    };
    return (
      <SafeAreaView style={s.fill} edges={["top", "left", "right"]}>
        <StatusBar style={c.dark ? "light" : "dark"} />
        {publicView.type === "share" ? (
          <ShareScreen token={publicView.token} onSignUp={signUp} />
        ) : (
          <LegalScreen doc={publicView.doc} onChange={(doc) => setPublicView({ type: "legal", doc })} onBack={signUp} />
        )}
      </SafeAreaView>
    );
  }

  if (session === undefined || (session && !settings)) {
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
        {authMode ? (
          <LoginScreen initialMode={authMode} onBack={Platform.OS === "web" ? () => setAuthMode(null) : undefined} onOpenLegal={(doc) => setPublicView({ type: "legal", doc })} />
        ) : (
          <LandingScreen onStart={setAuthMode} onOpenLegal={(doc) => setPublicView({ type: "legal", doc })} />
        )}
      </SafeAreaView>
    );
  }

  // First run (or new Terms): accept terms, profile, watchlist
  if (settings.needs_onboarding) {
    return (
      <SafeAreaView style={s.fill} edges={["top", "left", "right", "bottom"]}>
        <StatusBar style={c.dark ? "light" : "dark"} />
        {onboardingLegal ? (
          <LegalScreen doc={onboardingLegal} onChange={setOnboardingLegal} onBack={() => setOnboardingLegal(null)} />
        ) : (
          <OnboardingScreen onOpenLegal={setOnboardingLegal} onDone={({ settings: st }) => setSettings({ ...settings, ...st, needs_onboarding: false })} />
        )}
      </SafeAreaView>
    );
  }

  const sections = settings.is_admin ? [...SECTIONS, ADMIN] : SECTIONS;
  const moreItems = sections.slice(4);
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
  else if (top?.type === "automations") screen = <AutomationsScreen onBack={pop} />;
  else if (top?.type === "legal") screen = <LegalScreen doc={top.doc} onBack={pop} onChange={(doc) => setStack((st) => [...st.slice(0, -1), { type: "legal", doc }])} />;
  else if (tab === "today") screen = <TodayScreen onOpenStock={openStock} />;
  else if (tab === "trade") screen = <TradeScreen onOpenStock={openStock} />;
  else if (tab === "markets") screen = <MarketsScreen onOpenStock={openStock} />;
  else if (tab === "screener") screen = <ScreenerScreen onOpenStock={openStock} />;
  else if (tab === "portfolio") screen = <PortfolioScreen onOpenStock={openStock} onOpenTax={() => goTab("tax")} />;
  else if (tab === "alerts") screen = <AlertsScreen onOpenStock={openStock} onUnreadChange={setUnread} />;
  else if (tab === "copilot") screen = <CopilotScreen onOpenStock={openStock} onOpenAutomations={() => push({ type: "automations" })} />;
  else if (tab === "journal") screen = <JournalScreen onOpenStock={openStock} />;
  else if (tab === "tax") screen = <TaxScreen onOpenStock={openStock} />;
  else if (tab === "admin" && settings.is_admin) screen = <AdminScreen />;
  else if (tab === "account") screen = <AccountScreen email={session.user.email} onOpenLegal={openLegal} onOpenAdmin={() => goTab("admin")} />;
  else if (tab === "more") screen = <MoreScreen items={moreItems} onSelect={goTab} unread={unread} />;
  else screen = <HomeScreen email={session.user.email} onOpen={openBriefing} onOpenStock={openStock} showSignOut={!wide} />;

  const content = (
    <View style={s.contentOuter}>
      <View style={[s.content, wide && s.contentWide, wide && tab === "copilot" && !stack.length && { maxWidth: 880 }]}>
        <UpgradeContext.Provider value={openAccount}>{screen}</UpgradeContext.Provider>
      </View>
    </View>
  );

  if (wide) {
    return (
      <View style={[s.fill, { flexDirection: "row" }]}>
        <StatusBar style={c.dark ? "light" : "dark"} />
        <SafeAreaView edges={["top", "left", "bottom"]} style={[s.sidebar, width < 1024 && { width: 216 }]}>
          <View style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
            <Logo size={32} />
          </View>
          <ScrollView style={{ marginTop: 18 }} showsVerticalScrollIndicator={false}>
            {GROUPS.map(([group, keys]) => {
              const items = keys.map((k) => sections.find((x) => x.key === k)).filter(Boolean);
              if (!items.length) return null;
              return (
                <View key={group} style={{ marginBottom: 14 }}>
                  <Text style={s.navGroup}>{group}</Text>
                  {items.map((t) => {
                    const inSection = tab === t.key;
                    return (
                      <Pressable key={t.key} onPress={() => goTab(t.key)} style={({ hovered }) => [s.navItem, inSection && s.navActive, hovered && !inSection && s.navHover]} accessibilityRole="tab" accessibilityState={{ selected: inSection }}>
                        {inSection && <View style={s.navBar} />}
                        <NavIcon name={t.key} size={20} color={inSection ? c.primary : c.textSecondary} active={inSection} />
                        <Text style={[s.navText, inSection && { color: c.text }]}>{t.label}</Text>
                        {t.key === "alerts" && unread > 0 && <View style={s.navBadge}><Text style={s.badgeText}>{unread > 9 ? "9+" : unread}</Text></View>}
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>
          <Pressable onPress={() => goTab("account")} style={({ hovered }) => [s.account, hovered && { backgroundColor: c.primarySoft }]}>
            <View style={s.avatar}><Text style={s.avatarText}>{(session.user.email ?? "?").slice(0, 1).toUpperCase()}</Text></View>
            <Text style={s.accountEmail} numberOfLines={1}>{session.user.email}</Text>
            {!localMode && (
              <Pressable onPress={() => supabase.auth.signOut()} accessibilityLabel="Sign out" hitSlop={8}>
                <Ionicons name="log-out-outline" size={19} color={c.muted} />
              </Pressable>
            )}
          </Pressable>
        </SafeAreaView>
        <SafeAreaView edges={["top", "right", "bottom"]} style={{ flex: 1 }}>
          {content}
        </SafeAreaView>
      </View>
    );
  }

  const moreKeys = moreItems.map((x) => x.key);
  return (
    <SafeAreaView style={s.fill} edges={["top", "left", "right"]}>
      <StatusBar style={c.dark ? "light" : "dark"} />
      {content}
      <SafeAreaView edges={["bottom"]} style={s.tabBar}>
        {PHONE_TABS.map((t) => {
          const inSection = tab === t.key || (t.key === "more" && moreKeys.includes(tab));
          return (
            <Pressable key={t.key} style={s.tab} onPress={() => goTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: inSection }} accessibilityLabel={t.label}>
              <View style={[s.tabIconWrap, inSection && { backgroundColor: c.primarySoft }]}>
                <NavIcon name={t.key} size={22} color={inSection ? c.primary : c.muted} active={inSection} />
                {t.key === "more" && unread > 0 && <View style={s.badge}><Text style={s.badgeText}>{unread > 9 ? "9+" : unread}</Text></View>}
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
  sidebar: { width: 248, backgroundColor: c.surface, borderRightWidth: 1, borderRightColor: c.border, padding: 14, paddingTop: 20 },
  navGroup: { color: c.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 12, marginBottom: 4 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12 },
  navBar: { position: "absolute", left: -14, top: 8, bottom: 8, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: c.primary },
  navActive: { backgroundColor: c.primarySoft },
  navHover: { backgroundColor: c.surfaceAlt },
  navText: { color: c.textSecondary, fontWeight: "600", fontSize: 14.5, flex: 1, letterSpacing: -0.1 },
  navBadge: { backgroundColor: c.loss, borderRadius: 9, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  account: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, backgroundColor: c.surfaceAlt, marginTop: 12 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: c.primary, fontWeight: "800" },
  accountEmail: { flex: 1, color: c.textSecondary, fontSize: 13 },
  tabBar: { flexDirection: "row", backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 7, shadowColor: c.shadow, shadowOpacity: c.dark ? 0.4 : 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: -2 }, elevation: 12 },
  tab: { flex: 1, alignItems: "center", paddingBottom: 6, gap: 3 },
  tabIconWrap: { width: 52, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  tabLabel: { fontSize: 11, fontWeight: "600", color: c.muted, letterSpacing: 0.1 },
  badge: { position: "absolute", top: -2, right: 2, backgroundColor: c.loss, borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 2, borderColor: c.surface },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
}));
