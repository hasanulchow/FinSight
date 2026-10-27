import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { formatMoney, makeStyles, useTheme } from "../theme";
import { Button, Chip, Input, Segmented, Stat } from "./ui";
import { ErrorNotice } from "./Upgrade";

// Remembered for the session so the account size doesn't have to be retyped per stock
let lastAccount = "";
let lastRisk = "1";

/** Position-size calculator: how many shares to buy so a stop-out loses only X% of the account. */
export default function PositionSizerSheet({ ticker, price, visible, onClose }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [account, setAccount] = useState(lastAccount);
  const [riskPct, setRiskPct] = useState(lastRisk);
  const [side, setSide] = useState("long");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [maxPos, setMaxPos] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (visible) {
      setResult(null);
      setError(null);
      setEntry(price ? String(price) : "");
    }
  }, [visible, price]);

  async function calc(stopOverride) {
    lastAccount = account;
    lastRisk = riskPct;
    setBusy(true);
    setError(null);
    try {
      const st = stopOverride ?? stop;
      setResult(await api.positionSize({ ticker, account_size: Number(account), risk_pct: Number(riskPct), entry: Number(entry) || undefined, stop: Number(st) || undefined, side, max_position_pct: Number(maxPos) || undefined }));
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  const sug = result?.suggestions?.[side];
  const stopChoices = sug ? Object.entries({ "2× ATR": sug.atr_2x, [side === "long" ? "Below support" : "Above resistance"]: side === "long" ? sug.below_support : sug.above_resistance }).filter(([, v]) => v) : [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={s.header}>
            <View>
              <Text style={s.eyebrow}>Position size & risk</Text>
              <Text style={s.title}>{ticker}{price ? <Text style={s.price}>  ${price}</Text> : null}</Text>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8} style={s.close}>
              <Ionicons name="close" size={20} color={c.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled">
            <View style={{ marginTop: 12 }}>
              <Text style={s.label}>Account size ($)</Text>
              <Input value={account} onChangeText={setAccount} keyboardType="decimal-pad" placeholder="25000" />
            </View>
            <View style={[s.row, { alignItems: "center" }]}>
              <Text style={[s.label, { marginBottom: 0, flex: 1 }]}>Risk per trade</Text>
              <View style={s.chips}>
                {["0.5", "1", "2"].map((r) => (
                  <Chip key={r} label={`${r}%`} active={riskPct === r} onPress={() => setRiskPct(r)} />
                ))}
              </View>
            </View>
            <View style={{ marginTop: 12 }}>
              <Segmented options={[["long", "Long"], ["short", "Short"]]} value={side} onChange={setSide} />
            </View>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Entry</Text>
                <Input value={entry} onChangeText={setEntry} keyboardType="decimal-pad" placeholder="market" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Stop</Text>
                <Input value={stop} onChangeText={setStop} keyboardType="decimal-pad" placeholder="auto: 2× ATR" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Max position %</Text>
                <Input value={maxPos} onChangeText={setMaxPos} keyboardType="decimal-pad" placeholder="100" />
              </View>
            </View>
            <ErrorNotice error={error} />
            <Button title="Calculate" icon="calculator" onPress={() => calc()} loading={busy} disabled={!(Number(account) > 0)} size="lg" style={{ marginTop: 16 }} />

            {result && (
              <View style={s.result}>
                <View style={s.big}>
                  <Text style={s.bigLabel}>{side === "long" ? "Buy" : "Short"}</Text>
                  <Text style={[s.bigValue, { color: sections.risk.color }]}>{result.shares} shares</Text>
                  <Text style={s.muted}>
                    {formatMoney(result.position_value)} position · {result.position_pct_of_account}% of account
                    {result.capped_by_max_position ? " · capped by max position" : ""}
                  </Text>
                </View>
                <View style={s.statRow}>
                  <Stat label="Stop" value={`$${result.stop_price}`} hint={`${result.stop_source} · ${result.stop_distance_pct}% away`} />
                  <Stat label="Max loss" value={formatMoney(result.risk_dollars)} hint={`${result.risk_pct_of_account}% of account`} color={c.loss} />
                </View>
                <View style={[s.statRow, { marginTop: 8 }]}>
                  {Object.entries(result.targets).map(([k, v]) => (
                    <Stat key={k} label={`Target ${k}`} value={`$${v}`} color={c.gain} />
                  ))}
                </View>
                {stopChoices.length > 0 && (
                  <>
                    <Text style={[s.label, { marginTop: 14 }]}>Chart-based stops</Text>
                    <View style={s.chips}>
                      {stopChoices.map(([label, v]) => (
                        <Chip key={label} label={`${label}: $${v}`} active={Number(stop) === v} onPress={() => { setStop(String(v)); calc(String(v)); }} />
                      ))}
                    </View>
                  </>
                )}
                <Text style={[s.muted, { marginTop: 12 }]}>
                  If price hits your stop you lose about {formatMoney(result.risk_dollars)}; hitting 2R makes about {formatMoney(result.reward_at_2r)}. Gaps can skip past stops.
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay },
  sheet: { width: "100%", maxWidth: 580, backgroundColor: c.elevated, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, paddingBottom: 30, borderWidth: 1, borderColor: c.border },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 },
  eyebrow: { color: c.primary, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  title: { fontSize: 22, fontWeight: "800", color: c.text, marginTop: 2 },
  price: { fontSize: 15, fontWeight: "600", color: c.muted },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", gap: 10, marginTop: 12 },
  label: { fontWeight: "700", color: c.text, marginBottom: 6, fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  result: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: c.border },
  big: { alignItems: "center", marginBottom: 14 },
  bigLabel: { color: c.muted, fontWeight: "700", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  bigValue: { fontSize: 34, fontWeight: "800", letterSpacing: -1, fontVariant: ["tabular-nums"] },
  statRow: { flexDirection: "row", gap: 8 },
  muted: { color: c.muted, fontSize: 12, lineHeight: 17, textAlign: "center" },
}));
