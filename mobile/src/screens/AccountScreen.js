import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "../lib/api";
import { localMode, supabase } from "../lib/supabase";
import { makeStyles, useTheme } from "../theme";
import { Banner, Button, Input, Loading, PageHeader, Pill, SectionCard } from "../components/ui";
import { shareLink } from "../lib/share";

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
export default function AccountScreen({ email, onOpenLegal, onOpenAdmin }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [account, setAccount] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState(null);
  const [referral, setReferral] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // null = hidden, string = typed text
  const [deleting, setDeleting] = useState(false);
  const billingParam = Platform.OS === "web" && typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("billing") : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, p, st, r] = await Promise.all([api.account(), api.plans(), api.settings().catch(() => null), api.referrals().catch(() => null)]);
      setAccount(a);
      setPlans(p);
      setSettings(st);
      setReferral(r);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleBrief(v) {
    setSettings((st) => ({ ...st, brief_enabled: v }));
    await api.updateSettings({ brief_enabled: v }).catch((e) => setError(e.message));
  }

  async function invite() {
    const how = await shareLink({ title: "Join me on FinSight", message: `I use FinSight for stock research and my trading journal. Join with my link and we both get ${referral.days_per_signup} days of Pro:`, url: referral.link });
    if (how === "copied") setNotice("Invite link copied to the clipboard");
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await api.deleteAccount();
      if (!localMode) await supabase.auth.signOut();
      else setNotice("Local data deleted.");
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError(e.message);
    }
    setDeleting(false);
  }

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
                {account.pro_source === "referral" && <Text style={[s.planSub, { color: "rgba(255,255,255,0.85)" }]}>Free Pro from referrals until {new Date(account.pro_until).toLocaleDateString()}</Text>}
                {account.pro_source === "trial" && <Text style={[s.planSub, { color: "rgba(255,255,255,0.85)" }]}>Free trial</Text>}
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
                <>
                <Button title={account.trial_days > 0 ? `Start ${account.trial_days}-day free trial` : "Upgrade to Pro"} icon="rocket" size="lg" onPress={() => { api.track("upgrade_clicked", { trial: account.trial_days }); go(api.checkout); }} loading={busy} style={{ marginTop: 16 }} />
                {account.trial_days > 0 && <Text style={[s.muted, { textAlign: "center", marginTop: 8 }]}>Then {proPlan.price_label}. Cancel anytime before the trial ends and you won't be charged.</Text>}
                </>
              ) : (
                <Banner tone="info">Upgrades aren't switched on for this server yet. {localMode ? "Local mode: set DEV_PLAN=pro or free to test either plan." : "The owner needs to add Stripe keys."}</Banner>
              )}
              <Text style={[s.muted, { textAlign: "center", marginTop: 10 }]}>Secure checkout by Stripe. Educational research tools, not investment advice.</Text>
            </View>
          )}

          {notice && <Banner tone="success">{notice}</Banner>}

          {referral && (
            <SectionCard title="Invite friends, get Pro" subtitle={`You both get ${referral.days_per_signup} days of Pro per signup`} section={sections.coach}>
              <View style={s.refRow}>
                <View style={s.refCode}>
                  <Text style={s.muted}>Your code</Text>
                  <Text style={s.code}>{referral.code}</Text>
                </View>
                <View style={s.refCode}>
                  <Text style={s.muted}>Friends joined</Text>
                  <Text style={s.code}>{referral.signups}</Text>
                </View>
              </View>
              <Button title="Share invite link" icon="gift-outline" onPress={invite} style={{ marginTop: 12 }} />
            </SectionCard>
          )}

          {settings && (
            <SectionCard title="Notifications" section={sections.alerts}>
              <View style={s.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.settingLabel}>Morning brief</Text>
                  <Text style={s.muted}>An AI summary of your stocks every weekday before the open</Text>
                </View>
                <Switch value={settings.brief_enabled !== false} onValueChange={toggleBrief} trackColor={{ true: c.primary, false: c.borderStrong }} />
              </View>
            </SectionCard>
          )}

          <SectionCard title="Legal & privacy" section={sections.quality}>
            {[["terms", "Terms of Service"], ["privacy", "Privacy Policy"], ["disclaimer", "Risk Disclaimer"]].map(([k, label]) => (
              <Pressable key={k} onPress={() => onOpenLegal?.(k)} style={s.linkRow}>
                <Text style={s.settingLabel}>{label}</Text>
                <Ionicons name="chevron-forward" size={16} color={c.muted} />
              </Pressable>
            ))}
            {settings?.is_admin && onOpenAdmin && (
              <Pressable onPress={onOpenAdmin} style={s.linkRow}>
                <Text style={[s.settingLabel, { color: c.primary }]}>Business dashboard (admin)</Text>
                <Ionicons name="stats-chart" size={16} color={c.primary} />
              </Pressable>
            )}
          </SectionCard>

          {!localMode && <Button title="Sign out" icon="log-out-outline" variant="ghost" onPress={() => supabase.auth.signOut()} style={{ marginTop: 20 }} />}

          <View style={s.danger}>
            <Text style={s.settingLabel}>Delete account</Text>
            <Text style={s.muted}>Cancels any subscription, disconnects your broker and permanently deletes your data. This can't be undone.</Text>
            {confirmDelete == null ? (
              <Button title="Delete my account" variant="danger" icon="trash-outline" size="sm" onPress={() => setConfirmDelete("")} style={{ marginTop: 10, alignSelf: "flex-start" }} />
            ) : (
              <View style={{ marginTop: 10, gap: 8 }}>
                <Input value={confirmDelete} onChangeText={setConfirmDelete} placeholder="Type DELETE to confirm" autoCapitalize="characters" />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button title="Cancel" variant="ghost" size="sm" onPress={() => setConfirmDelete(null)} />
                  <Button title="Permanently delete" variant="danger" size="sm" onPress={deleteAccount} disabled={confirmDelete !== "DELETE"} loading={deleting} />
                </View>
              </View>
            )}
          </View>
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
  refRow: { flexDirection: "row", gap: 10 },
  refCode: { flex: 1, backgroundColor: c.surfaceAlt, borderRadius: 12, padding: 12 },
  code: { color: c.text, fontSize: 20, fontWeight: "800", letterSpacing: 1, marginTop: 2 },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  settingLabel: { color: c.text, fontSize: 15, fontWeight: "700" },
  linkRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border },
  danger: { marginTop: 24, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: c.lossSoft, backgroundColor: c.surface },
  upsell: { marginTop: 14, borderRadius: 24, padding: 22, borderWidth: 2, borderColor: c.primary, backgroundColor: c.surface },
  upsellHead: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  upsellTitle: { color: c.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.5, marginTop: 10 },
  upsellPrice: { color: c.text, fontSize: 20, fontWeight: "800", marginTop: 2 },
  perk: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  perkText: { flex: 1, color: c.text, fontSize: 15 },
}));
