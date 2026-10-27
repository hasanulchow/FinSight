import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { colors, formatMoney } from "../theme";
import { Bullets, Pill, SectionCard } from "./ui";

const eventsSection = { color: "#DB2777", soft: "#FCE7F3", icon: "calendar-outline" };
const SIGNAL = {
  net_buying: { label: "Insiders net buying", color: colors.green },
  net_selling: { label: "Insiders net selling", color: colors.red },
  mixed: { label: "Mixed insider activity", color: colors.amber },
  routine_only: { label: "Routine insider activity", color: colors.muted },
  none: { label: "No recent insider trades", color: colors.muted },
};

/** Earnings & smart money: next report, EPS surprises, latest results and Form 4 insider trades. Loads on its own. */
export default function EventsCard({ ticker }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showTrades, setShowTrades] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.events(ticker).then((d) => !cancelled && setData(d)).catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (error) {
    return (
      <SectionCard title="Earnings & insiders" section={eventsSection}>
        <Text style={styles.muted}>Couldn't load earnings and insider data: {error}</Text>
      </SectionCard>
    );
  }
  if (!data) {
    return (
      <SectionCard title="Earnings & insiders" section={eventsSection}>
        <View style={styles.loading}>
          <ActivityIndicator color={eventsSection.color} />
          <Text style={styles.muted}>Reading earnings and Form 4 filings…</Text>
        </View>
      </SectionCard>
    );
  }

  const next = data.next_earnings;
  const stats = data.insider_stats;
  const sig = SIGNAL[data.summary?.insider_signal] ?? SIGNAL.none;
  const daysTo = next ? Math.ceil((Date.parse(next.date) - Date.now()) / 86_400_000) : null;

  return (
    <SectionCard title="Earnings & insiders" section={eventsSection}>
      <View style={styles.nextBox}>
        <Ionicons name="calendar" size={22} color={eventsSection.color} />
        <View style={{ flex: 1 }}>
          <Text style={styles.nextTitle}>{next ? `Next earnings: ${next.date}` : "No earnings date in the next 90 days"}</Text>
          {next && (
            <Text style={styles.muted}>
              {daysTo <= 0 ? "Today" : `In ${daysTo} day${daysTo === 1 ? "" : "s"}`}
              {next.hour === "bmo" ? " · before the open" : next.hour === "amc" ? " · after the close" : ""}
              {next.epsEstimate != null ? ` · EPS est. $${next.epsEstimate}` : ""}
            </Text>
          )}
        </View>
      </View>

      {data.summary && (
        <>
          <Text style={styles.subhead}>Preview</Text>
          <Text style={styles.body}>{data.summary.earnings_preview}</Text>
          <Text style={styles.subhead}>Last results</Text>
          <Text style={styles.body}>{data.summary.earnings_recap}</Text>
        </>
      )}

      {data.surprises?.length > 0 && (
        <View style={styles.surprises}>
          {data.surprises.map((q) => {
            const beat = q.actual != null && q.estimate != null && q.actual >= q.estimate;
            return (
              <View key={q.period} style={[styles.surprise, { backgroundColor: beat ? colors.greenSoft : colors.redSoft }]}>
                <Text style={styles.small}>{q.period?.slice(0, 7)}</Text>
                <Text style={[styles.surpriseValue, { color: beat ? colors.green : colors.red }]}>{beat ? "Beat" : "Miss"}</Text>
                <Text style={styles.small}>${q.actual} vs ${q.estimate}</Text>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.insiderHead}>
        <Text style={styles.subhead}>Smart money: insiders</Text>
        <Pill text={sig.label} color={sig.color} />
      </View>
      <View style={styles.stats}>
        <Stat label="Open-market buys" value={stats.open_market_buys} sub={formatMoney(stats.value_bought)} color={colors.green} />
        <Stat label="Open-market sells" value={stats.open_market_sells} sub={formatMoney(stats.value_sold)} color={colors.red} />
        <Stat label="Grants & other" value={stats.other_transactions} sub={`last ${stats.window_days} days`} />
      </View>
      {data.summary && <Text style={[styles.body, { marginTop: 8 }]}>{data.summary.insider_summary}</Text>}

      {data.insider_trades?.length > 0 && (
        <Pressable style={styles.link} onPress={() => setShowTrades(!showTrades)}>
          <Ionicons name={showTrades ? "chevron-up" : "chevron-down"} size={16} color={eventsSection.color} />
          <Text style={[styles.linkText, { color: eventsSection.color }]}>{showTrades ? "Hide" : "Show"} recent Form 4 trades</Text>
        </Pressable>
      )}
      {showTrades && data.insider_trades.slice(0, 12).map((t, i) => (
        <View key={`${t.accession}-${i}`} style={styles.trade}>
          <Text style={[styles.tradeType, { color: t.code === "P" ? colors.green : t.code === "S" ? colors.red : colors.muted }]}>{t.type}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.tradeWho} numberOfLines={1}>{t.insider}{t.title ? ` · ${t.title}` : ""}</Text>
            <Text style={styles.small}>{t.date} · {t.shares.toLocaleString()} sh{t.price ? ` @ $${t.price}` : ""}{t.value ? ` · ${formatMoney(t.value)}` : ""}</Text>
          </View>
        </View>
      ))}

      {data.summary?.watch_items?.length > 0 && (
        <>
          <Text style={styles.subhead}>Watch for</Text>
          <Bullets items={data.summary.watch_items} color={eventsSection.color} />
        </>
      )}
      {data.latest_release?.url && (
        <Pressable style={styles.link} onPress={() => Linking.openURL(data.latest_release.url)}>
          <Ionicons name="open-outline" size={16} color={eventsSection.color} />
          <Text style={[styles.linkText, { color: eventsSection.color }]}>Read the latest earnings release</Text>
        </Pressable>
      )}
    </SectionCard>
  );
}

function Stat({ label, value, sub, color = colors.text }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.small}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.small}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted },
  small: { color: colors.muted, fontSize: 11 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  subhead: { fontWeight: "800", color: colors.text, marginTop: 12, marginBottom: 4 },
  loading: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 8 },
  nextBox: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#FCE7F3", borderRadius: 14, padding: 12 },
  nextTitle: { fontWeight: "800", color: colors.text, fontSize: 15 },
  surprises: { flexDirection: "row", gap: 6, marginTop: 12 },
  surprise: { flex: 1, borderRadius: 10, padding: 8, alignItems: "center" },
  surpriseValue: { fontWeight: "800", fontSize: 14, marginVertical: 2 },
  insiderHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  stats: { flexDirection: "row", gap: 8, marginTop: 4 },
  stat: { flex: 1, backgroundColor: colors.bg, borderRadius: 12, padding: 10 },
  statValue: { fontSize: 20, fontWeight: "800", marginVertical: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  linkText: { fontWeight: "700" },
  trade: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
  tradeType: { width: 62, fontWeight: "800", fontSize: 12, textTransform: "capitalize" },
  tradeWho: { color: colors.text, fontWeight: "600", fontSize: 13 },
});
