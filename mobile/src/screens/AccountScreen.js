import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, RefreshControl, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "../lib/api";
import { localMode, supabase } from "../lib/supabase";
import { makeStyles, useTheme } from "../theme";
import { Banner, Button, Loading, PageHeader, Pill, SectionCard } from "../components/ui";

const FEATURE_LABELS = {
  copilot: ["Copilot messages", "sparkles-outline"],
  briefing: ["AI briefings", "document-text-outline"],
  ai_tool: ["AI tools (screener, coach, X-ray, explanations)", "flash-outline"],
  question: ["10-K questions", "chatbubble-ellipses-outline"],
};
const PRO_PERKS = [
  "300 Copilot messages a day, with every tool",
  "40 full AI briefings a day",
  "200 AI screener, coach and X-ray runs a day",
  "100 alerts, 500 holdings and 20,000 journal trades",
];

// Web: return to the current page after Stripe. Native: Stripe returns to APP_URL on the server.
const returnUrl = () => (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin + window.location.pathname : undefined);

/** Plan, today's usage, upgrade to Pro (Stripe Checkout) and manage billing (Stripe portal). */
export default function AccountScreen({ email }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [account, setAccount] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const billingParam = Platform.OS === "web" && typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("billing") : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, p] = await Promise.all([api.account(), api.plans()]);
      setAccount(a);
      setPlans(p);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function go(fn) {
    setBusy(true);
    setError(null);
    try {
      const { url } = await fn(returnUrl());
      if (Platform.OS === "web") window.location.assign(url);
      else await Linking.openURL(url);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  const pro = account?.plan === "pro";
  const proPlan = plans.find((p) => p.key === "pro");
  const sub = account?.subscription;

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={loading && !!account} onRefresh={load} tintColor={c.primary} />}>
      <PageHeader eyebrow="Account" title="Plan & usage" subtitle={account?.email ?? email} />
      {billingParam === "success" && <Banner tone="success">Thanks for upgrading! Your Pro plan is active as soon as Stripe confirms the payment (usually a few seconds).</Banner>}
      {billingParam === "cancelled" && <Banner tone="info">Checkout cancelled. You haven't been charged.</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {loading && !account && <Loading text="Loading your plan…" />}

      {account && (
        <>
          <LinearGradient colors={pro ? c.brand.slice(0, 2) : [c.surface, c.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.planCard, !pro && { borderWidth: 1, borderColor: c.border }]}>
            <View style={s.planTop}>
              <View style={{ flex: 1 }}>
                <Text style={[s.planEyebrow, pro && { color: "rgba(255,255,255,0.8)" }]}>Current plan</Text>
                <Text style={[s.planName, pro && { color: "#FFFFFF" }]}>FinSight {account.plan_name}</Text>
                {sub?.current_period_end && (
                  <Text style={[s.planSub, pro && { color: "rgba(255,255,255,0.85)" }]}>
                    {sub.cancel_at_period_end ? "Ends" : "Renews"} {new Date(sub.current_period_end).toLocaleDateString()}
                  </Text>
                )}
              </View>
              <Ionicons name={pro ? "diamond" : "leaf-outline"} size={30} color={pro ? "#FFFFFF" : c.primary} />
            </View>
            {pro && account.billing_enabled && sub && (
              <Button title="Manage billing" icon="card-outline" variant="secondary" size="sm" onPress={() => go(api.billingPortal)} loading={busy} style={{ marginTop: 16, alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.2)" }} />
            )}
          </LinearGradient>

          <SectionCard title="Today's usage" subtitle="Resets every 24 hours" section={sections.account}>
            {Object.entries(account.usage).map(([key, u]) => {
              const [label, icon] = FEATURE_LABELS[key] ?? [key, "ellipse-outline"];
              const pct = Math.min(100, (u.used / Math.max(1, u.limit)) * 100);
              const color = pct >= 100 ? c.loss : pct >= 80 ? c.warn : c.primary;
              return (
                <View key={key} style={s.meter}>
                  <View style={s.meterHead}>
                    <Ionicons name={icon} size={15} color={c.textSecondary} />
                    <Text style={s.meterLabel}>{label}</Text>
                    <Text style={[s.meterValue, { color }]}>{u.used} / {u.limit}</Text>
                  </View>
                  <View style={s.track}>
                    <View style={[s.fill, { width: `${pct}%`, backgroundColor: color }]} />
                  </View>
                </View>
              );
            })}
            <Text style={s.muted}>Limits: {account.caps.alerts} alerts · {account.caps.holdings} holdings · {account.caps.trades.toLocaleString()} journal trades</Text>
          </SectionCard>

          {!pro && proPlan && (
            <View style={s.upsell}>
              <View style={s.upsellHead}>
                <View style={{ flex: 1 }}>
                  <Pill text="Most popular" color={c.primary} icon="star" />
                  <Text style={s.upsellTitle}>FinSight Pro</Text>
                  <Text style={s.upsellPrice}>
                    {proPlan.price_label}
                    <Text style={s.muted}>  cancel anytime</Text>
                  </Text>
                </View>
                <Ionicons name="diamond" size={34} color={c.primary} />
              </View>
              {PRO_PERKS.map((p) => (
                <View key={p} style={s.perk}>
                  <Ionicons name="checkmark-circle" size={18} color={c.gain} />
                  <Text style={s.perkText}>{p}</Text>
                </View>
              ))}
              {account.billing_enabled ? (
                <Button title="Upgrade to Pro" icon="rocket" size="lg" onPress={() => go(api.checkout)} loading={busy} style={{ marginTop: 16 }} />
              ) : (
                <Banner tone="info">Upgrades aren't switched on for this server yet. {localMode ? "Local mode: set DEV_PLAN=pro or free to test either plan." : "The owner needs to add Stripe keys."}</Banner>
              )}
              <Text style={[s.muted, { textAlign: "center", marginTop: 10 }]}>Secure checkout by Stripe. Educational research tools, not investment advice.</Text>
            </View>
          )}

          {!localMode && <Button title="Sign out" icon="log-out-outline" variant="ghost" onPress={() => supabase.auth.signOut()} style={{ marginTop: 20 }} />}
        </>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  planCard: { borderRadius: 24, padding: 22, marginTop: 4 },
  planTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  planEyebrow: { color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  planName: { color: c.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5, marginTop: 4 },
  planSub: { color: c.textSecondary, fontSize: 13, marginTop: 4 },
  meter: { marginBottom: 14 },
  meterHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  meterLabel: { flex: 1, color: c.text, fontSize: 14, fontWeight: "600" },
  meterValue: { fontWeight: "800", fontSize: 13, fontVariant: ["tabular-nums"] },
  track: { height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  muted: { color: c.muted, fontSize: 12, lineHeight: 17 },
  upsell: { marginTop: 14, borderRadius: 24, padding: 22, borderWidth: 2, borderColor: c.primary, backgroundColor: c.surface },
  upsellHead: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  upsellTitle: { color: c.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginTop: 10 },
  upsellPrice: { color: c.text, fontSize: 20, fontWeight: "800", marginTop: 2 },
  perk: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  perkText: { flex: 1, color: c.text, fontSize: 15 },
}));
