import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { api } from "../lib/api";
import { formatMoney, makeStyles, useTheme } from "../theme";
import { Loading, PageHeader, Pill, SectionCard, Stat } from "../components/ui";
import { ErrorNotice } from "../components/Upgrade";

/** Founder dashboard: users, revenue, usage and AI cost per user (ADMIN_EMAILS only). */
export default function AdminScreen() {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [m, setM] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setM(await api.adminMetrics());
      setError(null);
    } catch (e) {
      setError(e);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const usd = (v) => (v < 1 ? `$${v.toFixed(3)}` : formatMoney(v));
  const maxSignup = Math.max(1, ...(m?.signups_by_day ?? []).map((d) => d.count));
  const maxUsage = Math.max(1, ...Object.values(m?.usage_7d ?? {}));

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={loading && !!m} onRefresh={load} tintColor={c.primary} />}>
      <PageHeader eyebrow="Admin" title="Business dashboard" subtitle={m ? `Updated ${new Date(m.generated_at).toLocaleTimeString()}` : null} />
      <ErrorNotice error={error} />
      {loading && !m && <Loading />}
      {m && (
        <>
          <View style={s.stats}>
            <Stat label="MRR" value={formatMoney(m.revenue.mrr_usd)} hint={`${m.revenue.pro_paying} paying × $${m.revenue.price_usd}`} color={c.gain} />
            <Stat label="AI cost (30d)" value={usd(m.ai_cost_30d.total_usd)} hint={`${usd(m.ai_cost_30d.per_active_user_usd)} / active user`} />
            <Stat label="Gross margin" value={m.ai_cost_30d.gross_margin_pct != null ? `${m.ai_cost_30d.gross_margin_pct}%` : "–"} hint="MRR minus AI cost" />
          </View>
          <View style={[s.stats, { marginTop: 8 }]}>
            <Stat label="Users" value={m.users.total} hint={`+${m.users.new_7d} this week`} />
            <Stat label="Active (7d / 30d)" value={`${m.users.active_7d} / ${m.users.active_30d}`} />
            <Stat label="Conversion" value={`${m.revenue.conversion_pct}%`} hint={`${m.revenue.pro_trialing} trialing · ${m.revenue.pro_via_referral} referral`} />
          </View>

          <SectionCard title="Signups, last 30 days" section={sections.account}>
            {!m.signups_by_day.length && <Text style={s.muted}>No signups yet.</Text>}
            <View style={s.chart}>
              {m.signups_by_day.map((d) => (
                <View key={d.date} style={s.col}>
                  <View style={[s.colFill, { height: `${(d.count / maxSignup) * 100}%`, backgroundColor: c.primary }]} />
                </View>
              ))}
            </View>
            <Text style={s.muted}>{m.users.onboarded} onboarded · {m.users.referred} came from referrals · {m.revenue.cancelling} cancelling</Text>
          </SectionCard>

          <SectionCard title="Feature usage, last 7 days" section={sections.copilot}>
            {Object.entries(m.usage_7d).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <View key={k} style={s.row}>
                <Text style={s.rowLabel}>{k}</Text>
                <View style={s.track}><View style={[s.fill, { width: `${(v / maxUsage) * 100}%`, backgroundColor: sections.copilot.color }]} /></View>
                <Text style={s.rowValue}>{v}</Text>
              </View>
            ))}
            {!Object.keys(m.usage_7d).length && <Text style={s.muted}>No usage yet.</Text>}
          </SectionCard>

          <SectionCard title="AI cost by agent (30d)" section={sections.risk}>
            {m.ai_cost_30d.by_agent.map((a) => (
              <View key={a.agent} style={s.row}>
                <Text style={s.rowLabel}>{a.agent}</Text>
                <View style={s.track}><View style={[s.fill, { width: `${(a.usd / Math.max(0.0001, m.ai_cost_30d.by_agent[0].usd)) * 100}%`, backgroundColor: sections.risk.color }]} /></View>
                <Text style={s.rowValue}>{usd(a.usd)}</Text>
              </View>
            ))}
          </SectionCard>

          <SectionCard title="Most expensive users (30d)" section={sections.benchmark}>
            {m.ai_cost_30d.top_users.map((u) => (
              <View key={u.email} style={s.userRow}>
                <Text style={s.email} numberOfLines={1}>{u.email}</Text>
                {u.pro ? <Pill text="Pro" color={c.primary} /> : <Pill text="Free" color={c.muted} />}
                <Text style={s.rowValue}>{usd(u.usd)}</Text>
              </View>
            ))}
          </SectionCard>
        </>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  stats: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  muted: { color: c.muted, fontSize: 12, marginTop: 8 },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 90 },
  col: { flex: 1, height: "100%", justifyContent: "flex-end" },
  colFill: { borderRadius: 3, minHeight: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  rowLabel: { width: 120, color: c.textSecondary, fontSize: 13 },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  rowValue: { width: 70, textAlign: "right", color: c.text, fontWeight: "700", fontSize: 13, fontVariant: ["tabular-nums"] },
  userRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border },
  email: { flex: 1, color: c.text, fontSize: 13 },
}));
