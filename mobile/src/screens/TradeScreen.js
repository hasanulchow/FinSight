import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Banner, Button, Disclaimer, EmptyState, Input, Loading, Pill, SectionCard, Segmented, Stat, TickerAvatar } from "../components/ui";
import { ErrorNotice } from "../components/Upgrade";
import OrderSheet from "../components/OrderSheet";
import { BotsPanel } from "../components/Bots";
import LiveBadge from "../components/LiveBadge";
import { useLivePrices } from "../lib/live";
// Brokerage amounts are shown in full (no K/M rounding)
const usd = (v) => (v == null ? "–" : `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const signed = (v) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${usd(Math.abs(v ?? 0))}`;

/** Trade: a paper (practice) brokerage account, plus real orders through the user's own broker when enabled. */
export default function TradeScreen({ onOpenStock }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [mode, setMode] = useState("paper");
  const [account, setAcct] = useState(null);
  const [broker, setBroker] = useState(null);
  const [liveAccts, setLiveAccts] = useState([]);
  const [liveOrders, setLiveOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ticket, setTicket] = useState(null); // { ticker?, side }
  const [search, setSearch] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([api.paper(), api.broker().catch(() => null)]);
      setAcct(a);
      setBroker(b);
      if (b?.trading_enabled && b.connected) {
        const [accts, orders] = await Promise.all([api.liveAccounts().catch(() => []), api.liveOrders().catch(() => [])]);
        setLiveAccts(accts);
        setLiveOrders(orders);
      }
      setError(null);
    } catch (e) {
      setError(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // keep prices and resting orders fresh
    return () => clearInterval(t);
  }, [load]);

  async function cancel(id) {
    await api.paperCancel(id).catch(setError);
    load();
  }

  async function reset() {
    setConfirmReset(false);
    try {
      setAcct(await api.paperReset());
    } catch (e) {
      setError(e);
    }
  }

  // Re-price positions, equity and today's change on every streamed trade
  const live = useLivePrices(account?.positions.map((p) => p.ticker) ?? []);
  const acct = useMemo(() => {
    if (!account) return null;
    const positions = account.positions.map((p) => {
      const lp = live.prices[p.ticker];
      if (!lp?.live) return p;
      const price = lp.p;
      const boughtToday = String(p.opened_at ?? "").slice(0, 10) === new Date().toISOString().slice(0, 10);
      const ref = boughtToday ? p.avg_cost : lp.pc ?? p.price - (p.day_change ?? 0) / p.qty;
      return { ...p, price, live: true, value: p.qty * price, unrealized: (price - p.avg_cost) * p.qty, unrealized_pct: Number((((price - p.avg_cost) / p.avg_cost) * 100 * (p.qty < 0 ? -1 : 1)).toFixed(2)), day_change: (price - ref) * p.qty };
    });
    const invested = positions.reduce((sum, p) => sum + p.value, 0);
    const equity = account.cash + invested;
    return { ...account, positions, invested, equity, total_pnl: equity - account.starting_cash, total_pnl_pct: Number((((equity - account.starting_cash) / account.starting_cash) * 100).toFixed(2)), day_change: positions.reduce((sum, p) => sum + (p.day_change ?? 0), 0) };
  }, [account, live.prices]);
  const liveAvailable = broker?.trading_enabled && broker.connected;
  const up = (acct?.total_pnl ?? 0) >= 0;
  const anyLive = acct?.positions.some((p) => p.live);
  const openSearch = () => {
    const t = search.trim().toUpperCase();
    if (/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) {
      setSearch("");
      onOpenStock(t);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={loading && !!acct} onRefresh={load} tintColor={c.primary} />}>
      <Segmented options={[["paper", "Practice"], ["bots", "Bots"], ...(liveAvailable || broker?.trading_enabled ? [["live", "Real money"]] : [])]} value={mode} onChange={setMode} />
      {mode === "bots" && <BotsPanel onOpenStock={onOpenStock} />}
      <ErrorNotice error={error} />

      {mode === "paper" && (
        <>
          {!acct && !error && <Loading text="Opening your practice account…" />}
          {acct && (
            <LinearGradient colors={c.dark ? ["#111827", "#1E1B4B"] : ["#EEF2FF", "#F5F3FF"]} style={s.hero}>
              <View style={s.heroTop}>
                <Pill text="Practice account" color={c.primary} icon="school-outline" />
                {acct.positions.length > 0 && <LiveBadge status={live.status} live={anyLive} />}
                <Pill text={acct.market.label} color={acct.market.open ? c.gain : c.muted} icon={acct.market.open ? "radio-button-on" : "moon-outline"} />
              </View>
              <Text style={s.equity}>{usd(acct.equity)}</Text>
              <Text style={[s.pnl, { color: up ? c.gain : c.loss }]}>
                {signed(acct.total_pnl)} ({acct.total_pnl_pct > 0 ? "+" : ""}{acct.total_pnl_pct}%) all time · {signed(acct.day_change)} today
              </Text>
              <View style={s.statRow}>
                <Stat label="Buying power" value={usd(acct.buying_power)} />
                <Stat label="Invested" value={usd(acct.invested)} />
                <Stat label="Realized P/L" value={signed(acct.realized_pnl)} color={acct.realized_pnl >= 0 ? c.gain : c.loss} />
              </View>
              <View style={s.actions}>
                <Pressable onPress={() => setTicket({ side: "buy" })} style={[s.bigBtn, { backgroundColor: c.gain }]} accessibilityRole="button">
                  <Text style={s.bigBtnText}>Buy</Text>
                </Pressable>
                <Pressable onPress={() => setTicket({ side: "sell" })} style={[s.bigBtn, { backgroundColor: c.loss }]} accessibilityRole="button">
                  <Text style={s.bigBtnText}>Sell</Text>
                </Pressable>
              </View>
            </LinearGradient>
          )}

          <Input icon="search" value={search} onChangeText={setSearch} placeholder="Search a ticker to research or trade" autoCapitalize="characters" onSubmitEditing={openSearch} style={{ marginTop: 14 }} />

          {acct && (
            <SectionCard title="Positions" subtitle={acct.positions.length ? `${acct.positions.length} holding${acct.positions.length > 1 ? "s" : ""}` : null} section={sections.portfolio}>
              {!acct.positions.length && <EmptyState icon="trending-up-outline" title="No positions yet" text="You have $100,000 of practice money. Buy a stock to start; your rules checklist and the journal work here too." action={<Button title="Place your first trade" icon="add" onPress={() => setTicket({ side: "buy" })} />} />}
              {acct.positions.map((p) => (
                <Pressable key={p.ticker} onPress={() => onOpenStock(p.ticker)} style={({ hovered }) => [s.posRow, hovered && { backgroundColor: c.surfaceAlt }]}>
                  <TickerAvatar ticker={p.ticker} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.posTicker}>{p.ticker}</Text>
                    <Text style={s.muted} numberOfLines={1}>{p.qty < 0 ? `Short ${-p.qty}` : p.qty} sh · avg ${p.avg_cost.toFixed(2)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.posValue}>{p.qty < 0 ? `−${usd(-p.value)}` : usd(p.value)}</Text>
                    <Text style={[s.muted, { color: p.unrealized >= 0 ? c.gain : c.loss }]}>{signed(p.unrealized)} ({p.unrealized_pct}%)</Text>
                  </View>
                  <Button title={p.qty < 0 ? "Cover" : "Sell"} size="sm" variant="ghost" onPress={() => setTicket({ ticker: p.ticker, side: p.qty < 0 ? "buy" : "sell" })} />
                </Pressable>
              ))}
            </SectionCard>
          )}

          {acct?.open_orders.length > 0 && (
            <SectionCard title="Open orders" section={sections.alerts}>
              {acct.open_orders.map((o) => (
                <View key={o.id} style={s.orderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.orderTitle}>{o.side === "buy" ? "Buy" : o.side === "short" ? "Short" : "Sell"} {o.qty} {o.ticker}</Text>
                    <Text style={s.muted}>{o.type === "market" ? "Market · fills at the open" : `${o.type} at $${o.limit_price ?? o.stop_price}`} · {o.time_in_force === "day" ? "today" : "until cancelled"}</Text>
                  </View>
                  <Button title="Cancel" size="sm" variant="danger" onPress={() => cancel(o.id)} />
                </View>
              ))}
            </SectionCard>
          )}

          {acct?.recent_orders.length > 0 && (
            <SectionCard title="History" section={sections.journal}>
              {acct.recent_orders.slice(0, 15).map((o) => (
                <View key={o.id} style={s.orderRow}>
                  <Ionicons name={o.status === "filled" ? "checkmark-circle" : "close-circle-outline"} size={18} color={o.status === "filled" ? c.gain : c.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.orderTitle}>{o.side === "buy" ? "Bought" : "Sold"} {o.qty} {o.ticker}{o.status === "filled" ? ` at $${Number(o.filled_price).toFixed(2)}` : ""}</Text>
                    <Text style={s.muted}>{o.status}{o.reason ? ` · ${o.reason}` : ""} · {new Date(o.filled_at ?? o.closed_at ?? o.created_at).toLocaleString()}</Text>
                  </View>
                </View>
              ))}
            </SectionCard>
          )}

          {acct && (
            <View style={s.resetBox}>
              {confirmReset ? (
                <>
                  <Text style={s.muted}>Start over with {usd(acct.starting_cash)}? Positions and open orders are cleared; history and journal stay.</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <Button title="Cancel" size="sm" variant="ghost" onPress={() => setConfirmReset(false)} />
                    <Button title="Reset account" size="sm" variant="danger" onPress={reset} />
                  </View>
                </>
              ) : (
                <Button title="Reset practice account" size="sm" variant="ghost" icon="refresh" onPress={() => setConfirmReset(true)} />
              )}
            </View>
          )}
        </>
      )}

      {mode === "live" && (
        <>
          {!broker?.connected && <Banner tone="info">Connect your brokerage in Portfolio → Broker sync to trade with real money from FinSight.</Banner>}
          {liveAvailable && !liveAccts.length && <Loading text="Loading your brokerage accounts…" />}
          {liveAccts.map((a) => (
            <View key={a.id} style={s.liveCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.posTicker}>{a.institution} {a.number}</Text>
                <Text style={s.muted}>{a.name}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.posValue}>{a.total != null ? usd(a.total) : "–"}</Text>
                <Text style={s.muted}>Buying power {a.buying_power != null ? usd(a.buying_power) : "–"}</Text>
              </View>
            </View>
          ))}
          {liveAvailable && (
            <View style={[s.actions, { marginTop: 14 }]}>
              <Pressable onPress={() => setTicket({ side: "buy" })} style={[s.bigBtn, { backgroundColor: c.gain }]}><Text style={s.bigBtnText}>Buy</Text></Pressable>
              <Pressable onPress={() => setTicket({ side: "sell" })} style={[s.bigBtn, { backgroundColor: c.loss }]}><Text style={s.bigBtnText}>Sell</Text></Pressable>
            </View>
          )}
          {liveOrders.length > 0 && (
            <SectionCard title="Your real orders" section={sections.alerts}>
              {liveOrders.map((o) => (
                <View key={o.id} style={s.orderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.orderTitle}>{o.side === "buy" ? "Buy" : "Sell"} {o.qty} {o.ticker} · {o.type}</Text>
                    <Text style={s.muted}>{o.status}{o.result?.status ? ` (${o.result.status})` : ""}{o.result?.error ? ` · ${o.result.error}` : ""} · {new Date(o.placed_at ?? o.created_at).toLocaleString()}</Text>
                  </View>
                </View>
              ))}
            </SectionCard>
          )}
          <Banner tone="warn">Real orders use real money in your own brokerage account. FinSight does not give investment advice, and the Copilot can never place real orders.</Banner>
        </>
      )}

      <Disclaimer>Practice trading simulates fills at the last price and ignores fees, spreads and halts. Educational, not investment advice.</Disclaimer>
      <OrderSheet visible={!!ticket} onClose={() => { setTicket(null); load(); }} ticker={ticket?.ticker} side={ticket?.side} mode={mode} accounts={liveAccts} />
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  hero: { borderRadius: 24, padding: 20, marginTop: 12, borderWidth: 1, borderColor: c.border },
  heroTop: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  equity: { color: c.text, fontSize: 40, fontWeight: "800", letterSpacing: -1.2, marginTop: 14, fontVariant: ["tabular-nums"] },
  pnl: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  statRow: { flexDirection: "row", gap: 8, marginTop: 16, flexWrap: "wrap" },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  bigBtn: { flex: 1, borderRadius: 16, paddingVertical: 15, alignItems: "center" },
  bigBtnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  muted: { color: c.textSecondary, fontSize: 12, lineHeight: 17 },
  posRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border, borderRadius: 8 },
  posTicker: { color: c.text, fontWeight: "800", fontSize: 15 },
  posValue: { color: c.text, fontWeight: "800", fontSize: 15, fontVariant: ["tabular-nums"] },
  orderRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
  orderTitle: { color: c.text, fontWeight: "700", fontSize: 14 },
  resetBox: { marginTop: 18, alignItems: "flex-start" },
  liveCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, marginTop: 12 },
}));
