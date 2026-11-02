import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { useLivePrices } from "../lib/live";
import { makeStyles, useTheme } from "../theme";
import LiveBadge from "./LiveBadge";
import { QuestionCard } from "./Forecasts";

// Dashboard cards for the Today screen: the market at a glance (live), the practice account, this week's
// forecasts and what the trading bots are doing. On wide screens they form a right-hand rail.

const INDEXES = [["SPY", "S&P 500"], ["QQQ", "Nasdaq 100"], ["DIA", "Dow"], ["IWM", "Russell 2000"]];
const usd = (x) => (x == null ? "–" : `$${Number(x).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const signed = (x) => (x == null ? "–" : `${x >= 0 ? "+" : "−"}${usd(Math.abs(x))}`);

function Card({ title, icon, color, right, children, onPress }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.card}>
      <Pressable onPress={onPress} disabled={!onPress} style={s.cardHead} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={onPress ? `Open ${title}` : undefined}>
        <View style={[s.icon, { backgroundColor: c.soft(color) }]}><Ionicons name={icon} size={16} color={color} /></View>
        <Text style={s.cardTitle}>{title}</Text>
        <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 6 }}>
          {right}
          {onPress && <Ionicons name="chevron-forward" size={15} color={c.muted} />}
        </View>
      </Pressable>
      {children}
    </View>
  );
}

/** SPY, QQQ, DIA and IWM with live prices, plus the market regime the bots use. */
export function MarketPulse({ onOpenStock, compact = false }) {
  const { c } = useTheme();
  const s = useStyles();
  const live = useLivePrices(INDEXES.map(([t]) => t));
  const [regime, setRegime] = useState(null);
  useEffect(() => {
    api.marketRegime().then(setRegime).catch(() => {});
  }, []);
  const anyLive = INDEXES.some(([t]) => live.prices[t]?.live);
  const tone = regime?.state === "bull" ? c.gain : regime?.state === "bear" ? c.loss : c.warn;
  return (
    <Card title="Market" icon="pulse" color={c.hue("sky")} right={<LiveBadge status={live.status} live={anyLive} />}>
      <View style={[s.indexGrid, compact && { flexWrap: "nowrap" }]}>
        {INDEXES.map(([t, name]) => {
          const q = live.prices[t];
          const chg = q?.p && q.pc ? ((q.p - q.pc) / q.pc) * 100 : null;
          const col = chg == null ? c.muted : chg >= 0 ? c.gain : c.loss;
          return (
            <Pressable key={t} onPress={() => onOpenStock(t)} style={({ hovered }) => [s.index, hovered && { borderColor: c.borderStrong }]} accessibilityRole="button" accessibilityLabel={`Open ${name}`}>
              <Text style={s.indexName} numberOfLines={1}>{name}</Text>
              <Text style={s.indexPrice}>{q?.p ? q.p.toFixed(2) : "–"}</Text>
              <Text style={[s.indexChg, { color: col }]}>{chg == null ? " " : `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`}</Text>
            </Pressable>
          );
        })}
      </View>
      {regime?.state && regime.state !== "unknown" && (
        <View style={s.regime}>
          <View style={[s.dot, { backgroundColor: tone }]} />
          <Text style={s.muted}>
            {regime.state === "bull" ? "Strong uptrend" : regime.state === "bear" ? "SPY below its 200-day" : "Above the 200-day, not trending"} · SPY 200-day {regime.sma200}
          </Text>
        </View>
      )}
    </Card>
  );
}

/** Practice account equity, today's change and positions. */
export function PracticeCard({ onGoTab }) {
  const { c } = useTheme();
  const s = useStyles();
  const [acct, setAcct] = useState(null);
  useEffect(() => {
    api.paper().then(setAcct).catch(() => {});
  }, []);
  if (!acct) return null;
  const up = acct.total_pnl >= 0;
  return (
    <Card title="Practice account" icon="school-outline" color={c.primary} onPress={() => onGoTab("trade")}>
      <Text style={s.big}>{usd(acct.equity)}</Text>
      <Text style={[s.muted, { color: up ? c.gain : c.loss }]}>
        {signed(acct.total_pnl)} ({acct.total_pnl_pct}%) all time · {signed(acct.day_change)} today
      </Text>
      <Text style={[s.muted, { marginTop: 6 }]}>
        {acct.positions.length ? `${acct.positions.length} position${acct.positions.length > 1 ? "s" : ""} · ${acct.open_orders.length} open order${acct.open_orders.length === 1 ? "" : "s"}` : "No positions yet: try a practice trade"} · {acct.market.label}
      </Text>
    </Card>
  );
}

/** Up to two open forecast questions you haven't answered. */
export function ForecastsTeaser({ onGoTab, onOpenStock }) {
  const { sections } = useTheme();
  const s = useStyles();
  const [qs, setQs] = useState(null);
  const load = () => api.forecastQuestions().then(setQs).catch(() => setQs([]));
  useEffect(() => {
    load();
  }, []);
  if (!qs?.length) return null;
  const todo = qs.filter((q) => !q.mine && !q.locked);
  const pick = (todo.length ? todo : qs).slice(0, 2);
  return (
    <Card title="Forecasts" icon={sections.forecasts.icon} color={sections.forecasts.color} onPress={() => onGoTab("forecasts")} right={<Text style={s.muted}>{todo.length ? `${todo.length} to call` : "All called"}</Text>}>
      {pick.map((q) => <QuestionCard key={q.id} q={q} onChanged={load} onOpenStock={onOpenStock} />)}
    </Card>
  );
}

/** Your bots: how many are on, and their latest run. */
export function BotsCard({ onGoTab }) {
  const { c } = useTheme();
  const s = useStyles();
  const [bots, setBots] = useState(null);
  useEffect(() => {
    api.bots().then(setBots).catch(() => {});
  }, []);
  if (!bots) return null;
  const on = bots.filter((b) => b.enabled);
  const last = bots.map((b) => b.state?.last_log).filter(Boolean).sort((a, b) => b.at.localeCompare(a.at))[0];
  return (
    <Card title="Trading bots" icon="hardware-chip-outline" color={c.hue("violet")} onPress={() => onGoTab("trade")} right={<Text style={s.muted}>{bots.length ? `${on.length} of ${bots.length} on` : ""}</Text>}>
      {!bots.length ? (
        <Text style={s.muted}>Six strategies, from bull flags to oversold bounces. Backtest one, then let it trade your practice account.</Text>
      ) : (
        <>
          {bots.slice(0, 3).map((b) => (
            <View key={b.id} style={s.botRow}>
              <View style={[s.dot, { backgroundColor: b.enabled ? c.gain : c.borderStrong }]} />
              <Text style={s.botName} numberOfLines={1}>{b.name}</Text>
              <Text style={s.muted}>{b.state?.last_log ? `${b.state.last_log.setups} setup${b.state.last_log.setups === 1 ? "" : "s"}` : "not run yet"}</Text>
            </View>
          ))}
          {last && <Text style={[s.muted, { marginTop: 6 }]}>Last run {new Date(last.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</Text>}
        </>
      )}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  card: { marginTop: 14, padding: 16, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  icon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: c.text, fontSize: 15, fontWeight: "700" },
  indexGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  index: { flexGrow: 1, flexBasis: 120, padding: 10, borderRadius: 14, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: "transparent" },
  indexName: { color: c.muted, fontSize: 11.5, fontWeight: "600" },
  indexPrice: { color: c.text, fontSize: 16, fontWeight: "800", marginTop: 3, fontVariant: ["tabular-nums"] },
  indexChg: { fontSize: 12.5, fontWeight: "700", marginTop: 1, fontVariant: ["tabular-nums"] },
  regime: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  muted: { color: c.muted, fontSize: 12.5, lineHeight: 18 },
  big: { color: c.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.6, fontVariant: ["tabular-nums"] },
  botRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  botName: { color: c.text, fontSize: 13.5, fontWeight: "600", flex: 1 },
}));
