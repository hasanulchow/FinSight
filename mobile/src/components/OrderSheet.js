import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Banner, Button, Chip, Input, Segmented } from "./ui";
import { ErrorNotice } from "./Upgrade";
import Sheet from "./Sheet";
import LiveBadge from "./LiveBadge";
import { useLivePrices } from "../lib/live";
// Brokerage amounts are shown in full (no K/M rounding)
const usd = (v) => (v == null ? "–" : `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * Order ticket: enter → review (preview from the server) → place.
 * mode "paper" trades the practice account; mode "live" goes to the user's own broker and needs an
 * extra explicit confirmation. Nothing is placed without the final tap.
 */
export default function OrderSheet({ visible, onClose, ticker: presetTicker, side: presetSide = "buy", mode = "paper", accounts = [], onPlaced }) {
  const { c } = useTheme();
  const s = useStyles();
  const live = mode === "live";
  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState("buy");
  const [type, setType] = useState("market");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [tif, setTif] = useState("gtc");
  const [accountId, setAccountId] = useState(null);
  const [preview, setPreview] = useState(null);
  const sym = ticker.trim().toUpperCase();
  // Stream the ticker once typing pauses, not every partial symbol
  const [streamSym, setStreamSym] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setStreamSym(sym), 450);
    return () => clearTimeout(t);
  }, [sym]);
  const stream = useLivePrices(visible && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(streamSym) ? [streamSym] : []);
  const lq = stream.prices[sym];
  const [ack, setAck] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setTicker(presetTicker ?? "");
    setSide(presetSide);
    setType("market");
    setQty("");
    setPrice("");
    setTif(live ? "day" : "gtc");
    setAccountId(accounts[0]?.id ?? null);
    setPreview(null);
    setPlaced(null);
    setAck(false);
    setError(null);
  }, [visible, presetTicker, presetSide, live, accounts]);

  const order = () => ({
    ticker: ticker.trim().toUpperCase(), side, type, qty: Number(qty), time_in_force: tif,
    ...(type === "limit" && { limit_price: Number(price) }), ...(type === "stop" && { stop_price: Number(price) }),
    ...(live && { account_id: accountId }),
  });

  async function review() {
    setBusy(true);
    setError(null);
    try {
      setPreview(live ? await api.livePreview(order()) : await api.paperPreview(order()));
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  async function place() {
    setBusy(true);
    setError(null);
    try {
      const r = live ? await api.livePlace(preview.id) : await api.paperOrder(order());
      setPlaced(r);
      onPlaced?.(r);
    } catch (e) {
      setError(e);
      if (live && e.status === 409) setPreview(null); // expired preview: review again
    }
    setBusy(false);
  }

  const edit = (fn) => (v) => {
    fn(v);
    setPreview(null);
    setAck(false);
  };
  const failedRules = preview?.rules?.checks?.filter((x) => !x.passed) ?? [];
  const blocked = preview?.blocking?.length > 0;
  const est = live ? (preview?.preview?.price ?? (Number(price) || null)) : preview?.est_price;
  const account = accounts.find((a) => a.id === accountId);
  const sideColor = side === "buy" ? c.gain : c.loss;

  return (
    <Sheet visible={visible} onClose={onClose} eyebrow={live ? "Real order · your broker" : "Paper trading · practice money"} title={placed ? "Order sent" : `${side === "buy" ? "Buy" : "Sell"} ${ticker.trim().toUpperCase() || "stock"}`}>
      {placed ? (
        <View style={s.done}>
          <Ionicons name="checkmark-circle" size={44} color={c.gain} />
          <Text style={s.doneTitle}>
            {live
              ? `Sent to ${account?.institution ?? "your broker"}`
              : placed.status === "filled"
                ? `Filled at $${Number(placed.filled_price).toFixed(2)}`
                : placed.status === "open"
                  ? "Order is working"
                  : `Order ${placed.status}`}
          </Text>
          <Text style={s.muted}>
            {live
              ? `Status: ${placed.result?.status ?? "submitted"}. Check your broker for the fill.`
              : placed.status === "open"
                ? "It fills when the price reaches your level (or at the next open for market orders). You'll get a notification."
                : `${side === "buy" ? "Bought" : "Sold"} ${placed.qty} ${placed.ticker}. Closed trades are added to your journal.`}
          </Text>
          <Button title="Done" onPress={onClose} size="lg" style={{ marginTop: 18, alignSelf: "stretch" }} />
        </View>
      ) : (
        <>
          {live && accounts.length > 0 && (
            <>
              <Text style={s.label}>Account</Text>
              <View style={s.chips}>
                {accounts.map((a) => (
                  <Chip key={a.id} label={`${a.institution}${a.number ? ` ${a.number}` : ""}`} active={accountId === a.id} onPress={() => edit(setAccountId)(a.id)} />
                ))}
              </View>
            </>
          )}
          <Segmented options={[["buy", "Buy"], ["sell", "Sell"]]} value={side} onChange={edit(setSide)} />
          <View style={s.row}>
            <View style={{ flex: 1.2 }}>
              <Text style={s.label}>Ticker</Text>
              <Input value={ticker} onChangeText={edit(setTicker)} placeholder="AAPL" autoCapitalize="characters" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Shares</Text>
              <Input value={qty} onChangeText={edit(setQty)} keyboardType="decimal-pad" placeholder="10" />
            </View>
          </View>
          {lq?.p != null && (
            <View style={s.quoteRow}>
              <Text style={s.quoteText}>{sym} ${lq.p.toFixed(2)}</Text>
              {lq.pc ? <Text style={[s.quoteText, { color: lq.p >= lq.pc ? c.gain : c.loss }]}>{lq.p >= lq.pc ? "+" : ""}{(((lq.p - lq.pc) / lq.pc) * 100).toFixed(2)}%</Text> : null}
              <LiveBadge status={stream.status} live={!!lq.live} />
              {Number(qty) > 0 && <Text style={[s.hint, { marginTop: 0, marginLeft: "auto" }]}>≈ {usd(lq.p * Number(qty))}</Text>}
            </View>
          )}
          <Text style={s.label}>Order type</Text>
          <Segmented options={[["market", "Market"], ["limit", "Limit"], ["stop", "Stop"]]} value={type} onChange={edit(setType)} />
          {type !== "market" && (
            <View style={{ marginTop: 10 }}>
              <Input value={price} onChangeText={edit(setPrice)} keyboardType="decimal-pad" placeholder={type === "limit" ? "Limit price" : "Stop price"} />
              <Text style={s.hint}>{type === "limit" ? `Fills at $${price || "…"} or better.` : `Becomes a market order when the price ${side === "sell" ? "falls to" : "rises to"} $${price || "…"}.`}</Text>
            </View>
          )}
          <View style={s.tifRow}>
            <Text style={s.muted}>Good for</Text>
            <Chip label="Today" active={tif === "day"} onPress={() => edit(setTif)("day")} />
            <Chip label="Until cancelled" active={tif === "gtc"} onPress={() => edit(setTif)("gtc")} />
          </View>

          {preview && (
            <View style={s.review}>
              <Row label={live ? "Estimated price" : "Estimated price"} value={est != null ? `$${Number(est).toFixed(2)}` : "Market"} />
              <Row label={side === "buy" ? "Estimated cost" : "Estimated proceeds"} value={est != null ? usd(est * Number(qty)) : "–"} strong />
              {!live && <Row label="Buying power after" value={usd(preview.buying_power_after)} />}
              {live && preview.preview?.estimated_commission != null && <Row label="Commission" value={usd(preview.preview.estimated_commission)} />}
              {live && preview.preview?.remaining_cash != null && <Row label="Cash after" value={usd(preview.preview.remaining_cash)} />}
              {preview.warnings?.map((w) => <Banner key={w} tone="info">{w}</Banner>)}
              {preview.blocking?.map((w) => <Banner key={w} tone="error">{w}</Banner>)}
              {failedRules.length > 0 && (
                <View style={s.rules}>
                  <Text style={s.rulesTitle}>Breaks {failedRules.length} of your rules</Text>
                  {failedRules.map((r) => (
                    <View key={r.rule} style={s.ruleRow}>
                      <Ionicons name="close-circle" size={15} color={c.loss} />
                      <Text style={[s.muted, { flex: 1 }]}>{r.label}: {r.message}</Text>
                    </View>
                  ))}
                </View>
              )}
              {live && (
                <Pressable onPress={() => setAck(!ack)} style={s.ack} accessibilityRole="checkbox" accessibilityState={{ checked: ack }}>
                  <Ionicons name={ack ? "checkbox" : "square-outline"} size={22} color={ack ? c.primary : c.muted} />
                  <Text style={s.ackText}>I understand this places a real order with real money in my {account?.institution ?? "brokerage"} account. FinSight doesn't give investment advice.</Text>
                </Pressable>
              )}
            </View>
          )}

          <ErrorNotice error={error} />
          {!preview ? (
            <Button title="Review order" icon="eye-outline" onPress={review} loading={busy} disabled={!ticker.trim() || !(Number(qty) > 0) || (type !== "market" && !(Number(price) > 0)) || (live && !accountId)} size="lg" style={{ marginTop: 16 }} />
          ) : (
            <Pressable
              onPress={place}
              disabled={busy || blocked || (live && !ack)}
              style={({ pressed }) => [s.place, { backgroundColor: sideColor }, (busy || blocked || (live && !ack)) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
            >
              <Text style={s.placeText}>{busy ? "Placing…" : `${live ? "Place real" : "Place paper"} ${side} order`}</Text>
            </Pressable>
          )}
          <Text style={[s.hint, { textAlign: "center", marginTop: 10 }]}>
            {live ? "Orders go to your broker through SnapTrade. Prices can move before your order fills." : "Practice account with simulated fills at the last price. No real money."}
          </Text>
        </>
      )}
    </Sheet>
  );
}

function Row({ label, value, strong }) {
  const s = useStyles();
  return (
    <View style={s.reviewRow}>
      <Text style={s.muted}>{label}</Text>
      <Text style={[s.reviewValue, strong && { fontSize: 17 }]}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  label: { fontWeight: "700", color: c.text, marginBottom: 6, marginTop: 12, fontSize: 13 },
  row: { flexDirection: "row", gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  hint: { color: c.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
  quoteRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" },
  quoteText: { color: c.text, fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  muted: { color: c.textSecondary, fontSize: 13, lineHeight: 19 },
  tifRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" },
  review: { marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: c.surfaceAlt, gap: 4 },
  reviewRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  reviewValue: { color: c.text, fontWeight: "800", fontSize: 15, fontVariant: ["tabular-nums"] },
  rules: { marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: c.warnSoft, gap: 6 },
  rulesTitle: { color: c.text, fontWeight: "800", fontSize: 13 },
  ruleRow: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  ack: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 10 },
  ackText: { flex: 1, color: c.text, fontSize: 13, lineHeight: 19 },
  place: { marginTop: 16, borderRadius: 16, paddingVertical: 17, alignItems: "center" },
  placeText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  done: { alignItems: "center", paddingVertical: 16 },
  doneTitle: { color: c.text, fontSize: 20, fontWeight: "800", marginTop: 10, textAlign: "center" },
}));
