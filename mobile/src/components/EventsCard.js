import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { formatMoney, makeStyles, useTheme } from "../theme";
import { Bullets, Loading, Pill, SectionCard, Stat } from "./ui";

/** Earnings & smart money: next report, EPS surprises, latest results and Form 4 insider trades. Loads on its own. */
export default function EventsCard({ ticker }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const sec = sections.events;
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

  const SIGNAL = {
    net_buying: { label: "Insiders net buying", color: c.gain },
    net_selling: { label: "Insiders net selling", color: c.loss },
    mixed: { label: "Mixed insider activity", color: c.warn },
    routine_only: { label: "Routine activity", color: c.muted },
    none: { label: "No recent trades", color: c.muted },
  };

  if (error || !data) {
    return (
      <SectionCard title="Earnings & insiders" section={sec}>
        {error ? <Text style={s.muted}>Couldn't load earnings and insider data: {error}</Text> : <Loading text="Reading earnings and Form 4 filings…" />}
      </SectionCard>
    );
  }

  const next = data.next_earnings;
  const stats = data.insider_stats;
  const sig = SIGNAL[data.summary?.insider_signal] ?? SIGNAL.none;
  const daysTo = next ? Math.ceil((Date.parse(next.date) - Date.now()) / 86_400_000) : null;

  return (
    <SectionCard title="Earnings & insiders" subtitle="Finnhub calendar · SEC Form 4" section={sec}>
      <View style={[s.nextBox, { backgroundColor: sec.soft }]}>
        <View style={s.dateBadge}>
          <Text style={[s.dateMonth, { color: sec.color }]}>{next ? new Date(`${next.date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short" }) : "—"}</Text>
          <Text style={s.dateDay}>{next ? new Date(`${next.date}T12:00:00Z`).getUTCDate() : ""}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.nextTitle}>{next ? "Next earnings report" : "No report in the next 90 days"}</Text>
          {next && (
            <Text style={s.muted}>
              {daysTo <= 0 ? "Today" : `In ${daysTo} day${daysTo === 1 ? "" : "s"}`}
              {next.hour === "bmo" ? " · before the open" : next.hour === "amc" ? " · after the close" : ""}
              {next.epsEstimate != null ? ` · EPS est. $${Number(next.epsEstimate).toFixed(2)}` : ""}
            </Text>
          )}
        </View>
      </View>

      {data.summary && (
        <>
          <Text style={s.subhead}>Preview</Text>
          <Text style={s.body}>{data.summary.earnings_preview}</Text>
          <Text style={s.subhead}>Last results</Text>
          <Text style={s.body}>{data.summary.earnings_recap}</Text>
        </>
      )}

      {data.surprises?.length > 0 && (
        <View style={s.surprises}>
          {[...data.surprises].reverse().map((q) => {
            const beat = q.actual != null && q.estimate != null && q.actual >= q.estimate;
            const col = beat ? c.gain : c.loss;
            return (
              <View key={q.period} style={[s.surprise, { backgroundColor: c.soft(col) }]}>
                <Text style={s.small}>{q.period?.slice(0, 7)}</Text>
                <Text style={[s.surpriseValue, { color: col }]}>{beat ? "Beat" : "Miss"}</Text>
                <Text style={s.small}>${q.actual} vs {Number(q.estimate).toFixed(2)}</Text>
              </View>
            );
          })}
        </View>
      )}

      <View style={s.insiderHead}>
        <Text style={[s.subhead, { marginTop: 0 }]}>Smart money: insiders</Text>
        <Pill text={sig.label} color={sig.color} />
      </View>
      <View style={s.stats}>
        <Stat label="Buys" value={stats.open_market_buys} hint={formatMoney(stats.value_bought)} color={c.gain} />
        <Stat label="Sells" value={stats.open_market_sells} hint={formatMoney(stats.value_sold)} color={c.loss} />
        <Stat label="Grants & other" value={stats.other_transactions} hint={`last ${stats.window_days} days`} />
      </View>
      {data.summary && <Text style={[s.body, { marginTop: 10 }]}>{data.summary.insider_summary}</Text>}

      {data.insider_trades?.length > 0 && (
        <Pressable style={s.link} onPress={() => setShowTrades(!showTrades)}>
          <Ionicons name={showTrades ? "chevron-up" : "chevron-down"} size={16} color={sec.color} />
          <Text style={[s.linkText, { color: sec.color }]}>{showTrades ? "Hide" : "Show"} recent Form 4 trades</Text>
        </Pressable>
      )}
      {showTrades && data.insider_trades.slice(0, 12).map((t, i) => (
        <View key={`${t.accession}-${i}`} style={s.trade}>
          <View style={[s.tradeTag, { backgroundColor: c.soft(t.code === "P" ? c.gain : t.code === "S" ? c.loss : c.muted) }]}>
            <Text style={[s.tradeType, { color: t.code === "P" ? c.gain : t.code === "S" ? c.loss : c.muted }]}>{t.type}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.tradeWho} numberOfLines={1}>{t.insider}{t.title ? ` · ${t.title}` : ""}</Text>
            <Text style={s.small}>{t.date} · {t.shares.toLocaleString()} sh{t.price ? ` @ $${t.price}` : ""}{t.value ? ` · ${formatMoney(t.value)}` : ""}</Text>
          </View>
        </View>
      ))}

      {data.summary?.watch_items?.length > 0 && (
        <>
          <Text style={s.subhead}>Watch for</Text>
          <Bullets items={data.summary.watch_items} color={sec.color} />
        </>
      )}
      {data.latest_release?.url && (
        <Pressable style={s.link} onPress={() => Linking.openURL(data.latest_release.url)}>
          <Ionicons name="open-outline" size={16} color={sec.color} />
          <Text style={[s.linkText, { color: sec.color }]}>Read the latest earnings release</Text>
        </Pressable>
      )}
    </SectionCard>
  );
}

const useStyles = makeStyles((c) => ({
  muted: { color: c.muted, fontSize: 13, marginTop: 2 },
  small: { color: c.muted, fontSize: 11 },
  body: { color: c.text, fontSize: 14, lineHeight: 21 },
  subhead: { fontWeight: "700", color: c.text, marginTop: 14, marginBottom: 4, fontSize: 13 },
  nextBox: { flexDirection: "row", gap: 12, alignItems: "center", borderRadius: 16, padding: 12 },
  dateBadge: { width: 50, height: 54, borderRadius: 12, backgroundColor: c.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border },
  dateMonth: { fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  dateDay: { fontSize: 20, fontWeight: "800", color: c.text, marginTop: -2 },
  nextTitle: { fontWeight: "800", color: c.text, fontSize: 15 },
  surprises: { flexDirection: "row", gap: 6, marginTop: 14 },
  surprise: { flex: 1, borderRadius: 12, padding: 8, alignItems: "center" },
  surpriseValue: { fontWeight: "800", fontSize: 14, marginVertical: 2 },
  insiderHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 8, gap: 8 },
  stats: { flexDirection: "row", gap: 8 },
  link: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 },
  linkText: { fontWeight: "700" },
  trade: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: c.border },
  tradeTag: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, minWidth: 54, alignItems: "center" },
  tradeType: { fontWeight: "800", fontSize: 11, textTransform: "capitalize" },
  tradeWho: { color: c.text, fontWeight: "600", fontSize: 13 },
}));
