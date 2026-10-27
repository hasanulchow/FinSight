import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api } from "../lib/api";
import { formatMoney, makeStyles, useTheme } from "../theme";
import { Bullets, Button, Input, Segmented, Stat } from "./ui";
import { ErrorNotice } from "./Upgrade";
import Sheet from "./Sheet";

const signed = (v) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${formatMoney(Math.abs(v))}`;
const PARTS = [["stock_move", "Stock move"], ["time_decay", "Time decay"], ["volatility", "Volatility (IV)"], ["other", "Other"]];

/** "Why did my option lose money?": P/L split into stock move, time decay and IV change. `preset` pre-fills fields. */
export default function OptionPnlSheet({ visible, onClose, preset }) {
  const { c } = useTheme();
  const s = useStyles();
  const [f, setF] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setF({ type: "call", side: "long", contracts: "1", ...Object.fromEntries(Object.entries(preset ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)])) });
    setResult(null);
    setError(null);
  }, [visible, preset]);

  async function run() {
    setBusy(true);
    setError(null);
    const num = (v) => (v === "" || v == null ? undefined : Number(v));
    try {
      setResult(await api.optionPnl({
        ticker: f.ticker?.trim().toUpperCase(), type: f.type, side: f.side, strike: num(f.strike), expiration: f.expiration, contracts: num(f.contracts),
        entry_date: f.entry_date, entry_price: num(f.entry_price), exit_date: f.exit_date || undefined, exit_price: num(f.exit_price),
        entry_underlying: num(f.entry_underlying), exit_underlying: num(f.exit_underlying),
      }));
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  const maxAbs = result ? Math.max(1, ...PARTS.map(([k]) => Math.abs(result.attribution[k] ?? 0))) : 1;

  return (
    <Sheet visible={visible} onClose={onClose} eyebrow="Option P/L explainer" title="Why did my option do that?" maxWidth={640}>
      <View style={s.row}>
        <Field label="Ticker" style={{ flex: 1 }}><Input value={f.ticker} onChangeText={set("ticker")} placeholder="AAPL" autoCapitalize="characters" /></Field>
        <Field label="Type" style={{ flex: 1 }}><Segmented options={[["call", "Call"], ["put", "Put"]]} value={f.type} onChange={set("type")} /></Field>
        <Field label="Side" style={{ flex: 1 }}><Segmented options={[["long", "Bought"], ["short", "Sold"]]} value={f.side} onChange={set("side")} /></Field>
      </View>
      <View style={s.row}>
        <Field label="Strike" style={{ flex: 1 }}><Input value={f.strike} onChangeText={set("strike")} keyboardType="decimal-pad" placeholder="250" /></Field>
        <Field label="Expiration" style={{ flex: 1.3 }}><Input value={f.expiration} onChangeText={set("expiration")} placeholder="YYYY-MM-DD" /></Field>
        <Field label="Contracts" style={{ flex: 0.8 }}><Input value={f.contracts} onChangeText={set("contracts")} keyboardType="number-pad" /></Field>
      </View>
      <View style={s.row}>
        <Field label="Entry date" style={{ flex: 1.2 }}><Input value={f.entry_date} onChangeText={set("entry_date")} placeholder="YYYY-MM-DD" /></Field>
        <Field label="Price paid" style={{ flex: 1 }}><Input value={f.entry_price} onChangeText={set("entry_price")} keyboardType="decimal-pad" placeholder="per share" /></Field>
        <Field label="Price now / exit" style={{ flex: 1 }}><Input value={f.exit_price} onChangeText={set("exit_price")} keyboardType="decimal-pad" placeholder="per share" /></Field>
      </View>
      <View style={s.row}>
        <Field label="Exit date (blank = today)" style={{ flex: 1.2 }}><Input value={f.exit_date} onChangeText={set("exit_date")} placeholder="YYYY-MM-DD" /></Field>
        <Field label="Stock at entry" style={{ flex: 1 }}><Input value={f.entry_underlying} onChangeText={set("entry_underlying")} keyboardType="decimal-pad" placeholder="auto" /></Field>
        <Field label="Stock at exit" style={{ flex: 1 }}><Input value={f.exit_underlying} onChangeText={set("exit_underlying")} keyboardType="decimal-pad" placeholder="auto" /></Field>
      </View>
      <ErrorNotice error={error} />
      <Button title="Explain" icon="analytics" onPress={run} loading={busy} size="lg" style={{ marginTop: 16 }} />

      {result && (
        <View style={s.result}>
          <Text style={[s.total, { color: result.total_pnl >= 0 ? c.gain : c.loss }]}>{signed(result.total_pnl)}</Text>
          <Text style={s.headline}>{result.headline}</Text>
          {PARTS.map(([k, label]) => {
            const v = result.attribution[k] ?? 0;
            if (k === "other" && Math.abs(v) < 1) return null;
            return (
              <View key={k} style={s.partRow}>
                <Text style={s.partLabel}>{label}</Text>
                <View style={s.track}>
                  <View style={[s.fill, { width: `${(Math.abs(v) / maxAbs) * 100}%`, backgroundColor: v >= 0 ? c.gain : c.loss }]} />
                </View>
                <Text style={[s.partValue, { color: v >= 0 ? c.gain : c.loss }]}>{signed(v)}</Text>
              </View>
            );
          })}
          <View style={{ marginTop: 12 }}>
            <Bullets items={result.explanation} />
          </View>
          <View style={s.stats}>
            <Stat label="IV at entry → now" value={`${result.entry.iv_pct ?? "–"}% → ${result.exit.iv_pct ?? "–"}%`} />
            <Stat label="Theta per day (at entry)" value={signed(result.greeks_at_entry.theta_per_day)} />
            <Stat label="Breakeven at expiry" value={`$${result.breakeven_at_expiry}`} />
          </View>
          <Text style={s.note}>{result.note}</Text>
        </View>
      )}
    </Sheet>
  );
}

function Field({ label, children, style }) {
  const s = useStyles();
  return (
    <View style={[{ marginTop: 12 }, style]}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  label: { fontWeight: "700", color: c.text, marginBottom: 6, fontSize: 12 },
  result: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: c.border },
  total: { fontSize: 32, fontWeight: "800", letterSpacing: -1, textAlign: "center", fontVariant: ["tabular-nums"] },
  headline: { color: c.text, fontSize: 15, fontWeight: "600", lineHeight: 22, textAlign: "center", marginTop: 4, marginBottom: 12 },
  partRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  partLabel: { width: 112, color: c.textSecondary, fontSize: 13, fontWeight: "600" },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: c.surfaceAlt, overflow: "hidden" },
  fill: { height: 10, borderRadius: 5 },
  partValue: { width: 76, textAlign: "right", fontWeight: "800", fontSize: 13, fontVariant: ["tabular-nums"] },
  stats: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  note: { color: c.muted, fontSize: 11, lineHeight: 16, marginTop: 10 },
}));
