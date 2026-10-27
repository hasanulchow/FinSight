import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { colors, formatMoney, tickerColor } from "../theme";
import { Bullets, Pill, PrimaryButton, SectionCard, TickerAvatar } from "../components/ui";

const xraySection = { color: "#7C3AED", soft: "#F3E8FF", icon: "scan-outline" };
const RISK = { low: colors.green, moderate: colors.amber, elevated: "#EA580C", high: colors.red };
const CSV_EXAMPLE = "Symbol,Quantity,Average Cost\nAAPL,10,150\nMSFT,5,300\nNVDA,20,";

/** Portfolio X-ray: holdings, allocation, concentration, technical health, upcoming earnings, AI read. */
export default function PortfolioScreen({ onOpenStock }) {
  const [xray, setXray] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Numbers first (fast), then the AI analysis
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = await api.xray({ analysis: false });
      setXray(base);
      setLoading(false);
      if (!base.empty) {
        setAnalyzing(true);
        const full = await api.xray().catch(() => null);
        if (full?.analysis) setXray(full);
        setAnalyzing(false);
      }
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id) {
    await api.deleteHolding(id).catch((e) => setError(e.message));
    load();
  }

  const empty = xray?.empty;
  const a = xray?.analysis;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={loading && !!xray} onRefresh={load} tintColor={xraySection.color} />}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Portfolio X-ray</Text>
        {xray && !empty ? (
          <>
            <Text style={styles.total}>{formatMoney(xray.total_value)}</Text>
            <Text style={[styles.dayChange, { color: xray.day_change >= 0 ? "#A7F3D0" : "#FECACA" }]}>
              {xray.day_change >= 0 ? "▲" : "▼"} {formatMoney(Math.abs(xray.day_change))} ({xray.day_change_pct}%) today
            </Text>
            {xray.unrealized_pl != null && <Text style={styles.heroSub}>Unrealized P/L {xray.unrealized_pl >= 0 ? "+" : "-"}{formatMoney(Math.abs(xray.unrealized_pl))} ({xray.unrealized_pl_pct}%)</Text>}
          </>
        ) : (
          <Text style={styles.heroSub}>See concentration, sector exposure, chart health and upcoming earnings across everything you own.</Text>
        )}
        <View style={styles.heroActions}>
          <Pressable style={styles.heroButton} onPress={() => setImportOpen(true)}>
            <Ionicons name="cloud-upload-outline" size={18} color={colors.white} />
            <Text style={styles.heroButtonText}>Import CSV</Text>
          </Pressable>
          <Pressable style={styles.heroButton} onPress={() => setAddOpen(true)}>
            <Ionicons name="add" size={18} color={colors.white} />
            <Text style={styles.heroButtonText}>Add holding</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ padding: 16, paddingTop: 0 }}>
        {loading && !xray && <ActivityIndicator color={xraySection.color} style={{ marginTop: 30 }} />}
        {error && <Text style={styles.error}>{error}</Text>}

        {empty && (
          <View style={styles.empty}>
            <Ionicons name="pie-chart-outline" size={40} color={xraySection.color} />
            <Text style={styles.emptyTitle}>Add your portfolio</Text>
            <Text style={styles.emptyText}>Export positions from your broker as CSV and paste them in, or add holdings one by one. Prices and charts update automatically.</Text>
          </View>
        )}

        {xray && !empty && (
          <>
            <SectionCard title="Risk at a glance" section={xraySection} right={a?.risk_level ? <Pill text={`${a.risk_level} risk`} color={RISK[a.risk_level]} /> : null}>
              <View style={styles.tiles}>
                <Tile label="Largest holding" value={`${xray.concentration.top_holding_pct}%`} />
                <Tile label="Top 3" value={`${xray.concentration.top3_pct}%`} />
                <Tile label="Acts like" value={`${xray.concentration.effective_holdings} stocks`} hint={xray.concentration.diversification} />
              </View>
              <Text style={styles.subhead}>Sectors</Text>
              {xray.sectors.map((s) => (
                <View key={s.sector} style={styles.barRow}>
                  <Text style={styles.barLabel} numberOfLines={1}>{s.sector}</Text>
                  <View style={styles.barTrack}><View style={[styles.barFill, { width: `${s.weight}%`, backgroundColor: tickerColor(s.sector) }]} /></View>
                  <Text style={styles.barValue}>{s.weight}%</Text>
                </View>
              ))}
            </SectionCard>

            <SectionCard title="AI X-ray" section={{ ...xraySection, icon: "sparkles-outline" }}>
              {a ? (
                <>
                  <Text style={styles.headline}>{a.headline}</Text>
                  <Text style={styles.body}>{a.summary}</Text>
                  <Text style={styles.subhead}>Concentration</Text>
                  <Text style={styles.body}>{a.concentration}</Text>
                  <Text style={styles.subhead}>Sector exposure</Text>
                  <Text style={styles.body}>{a.sector_exposure}</Text>
                  <Text style={styles.subhead}>Chart health</Text>
                  <Text style={styles.body}>{a.technical_health}</Text>
                  <Text style={styles.subhead}>Coming up</Text>
                  <Text style={styles.body}>{a.upcoming}</Text>
                  <Text style={styles.subhead}>Things to watch</Text>
                  <Bullets items={a.things_to_watch} color={xraySection.color} />
                </>
              ) : analyzing ? (
                <View style={styles.inline}><ActivityIndicator color={xraySection.color} /><Text style={styles.muted}>Analyzing your portfolio…</Text></View>
              ) : (
                <Text style={styles.muted}>{xray.analysis_error ?? "AI analysis unavailable right now. Pull to refresh."}</Text>
              )}
            </SectionCard>

            {xray.upcoming_earnings?.length > 0 && (
              <SectionCard title="Earnings in the next 30 days" section={{ color: "#DB2777", soft: "#FCE7F3", icon: "calendar-outline" }}>
                {xray.upcoming_earnings.map((e) => (
                  <Pressable key={e.ticker + e.date} style={styles.earningRow} onPress={() => onOpenStock(e.ticker)}>
                    <Text style={styles.earningTicker}>{e.ticker}</Text>
                    <Text style={styles.body}>{e.date}{e.hour === "bmo" ? " · before open" : e.hour === "amc" ? " · after close" : ""}</Text>
                  </Pressable>
                ))}
              </SectionCard>
            )}

            <Text style={styles.sectionTitle}>Holdings</Text>
            {xray.positions.map((p) => (
              <Pressable key={p.id} style={({ pressed }) => [styles.holding, pressed && { opacity: 0.85 }]} onPress={() => onOpenStock(p.ticker)}>
                <TickerAvatar ticker={p.ticker} size={42} />
                <View style={{ flex: 1 }}>
                  <View style={styles.holdingTop}>
                    <Text style={styles.holdingName} numberOfLines={1}>{p.ticker}</Text>
                    <Text style={styles.holdingValue}>{formatMoney(p.value)}</Text>
                  </View>
                  <View style={styles.holdingTop}>
                    <Text style={styles.muted}>{p.shares} sh · {p.weight}%</Text>
                    <Text style={{ color: (p.change_pct ?? 0) >= 0 ? colors.green : colors.red, fontWeight: "700", fontSize: 13 }}>{p.change_pct >= 0 ? "+" : ""}{p.change_pct}%</Text>
                  </View>
                  <View style={styles.tags}>
                    {p.pl_pct != null && <Pill text={`P/L ${p.pl_pct >= 0 ? "+" : ""}${p.pl_pct}%`} color={p.pl_pct >= 0 ? colors.green : colors.red} />}
                    {p.technicals?.trend && <Pill text={p.technicals.trend} color={p.technicals.trend === "uptrend" ? colors.green : p.technicals.trend === "downtrend" ? colors.red : colors.muted} />}
                    {p.technicals?.rsi14 != null && (p.technicals.rsi14 >= 70 || p.technicals.rsi14 <= 30) && <Pill text={`RSI ${p.technicals.rsi14}`} color={colors.amber} />}
                  </View>
                </View>
                <Pressable onPress={() => remove(p.id)} hitSlop={10} accessibilityLabel={`Remove ${p.ticker}`}>
                  <Ionicons name="trash-outline" size={18} color={colors.muted} />
                </Pressable>
              </Pressable>
            ))}
            {xray.unpriced?.length > 0 && <Text style={styles.muted}>No price found for: {xray.unpriced.join(", ")}</Text>}
            <Text style={styles.disclaimer}>Educational analysis, not investment advice. Holdings stay private to your account.</Text>
          </>
        )}
      </View>

      <ImportModal visible={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
      <AddModal visible={addOpen} onClose={() => setAddOpen(false)} onDone={load} />
    </ScrollView>
  );
}

function Tile({ label, value, hint }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  );
}

function Sheet({ visible, onClose, title, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close"><Ionicons name="close" size={24} color={colors.muted} /></Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

function ImportModal({ visible, onClose, onDone }) {
  const [csv, setCsv] = useState("");
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.importCsv(csv, replace ? "replace" : "merge");
      setCsv("");
      onDone();
      onClose();
      if (r.skipped?.length) console.warn("Skipped rows:", r.skipped);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Import from CSV">
      <Text style={styles.muted}>Paste your broker's positions export. Columns like Symbol, Quantity and Average Cost are detected automatically; simple lines like "AAPL,10,150" work too.</Text>
      <TextInput style={styles.csvInput} multiline value={csv} onChangeText={setCsv} placeholder={CSV_EXAMPLE} placeholderTextColor={colors.muted} autoCapitalize="characters" autoCorrect={false} />
      <Pressable style={styles.checkRow} onPress={() => setReplace(!replace)}>
        <Ionicons name={replace ? "checkbox" : "square-outline"} size={20} color={colors.primary} />
        <Text style={styles.body}>Replace my current holdings</Text>
      </Pressable>
      {msg && <Text style={styles.error}>{msg}</Text>}
      <PrimaryButton title="Import" icon="cloud-upload-outline" onPress={submit} loading={busy} disabled={!csv.trim()} style={{ marginTop: 12 }} />
    </Sheet>
  );
}

function AddModal({ visible, onClose, onDone }) {
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      await api.addHolding({ ticker, shares: Number(shares), cost_basis: cost ? Number(cost) : null });
      setTicker("");
      setShares("");
      setCost("");
      onDone();
      onClose();
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Add a holding">
      <Text style={styles.label}>Ticker</Text>
      <TextInput style={styles.field} value={ticker} onChangeText={setTicker} placeholder="AAPL" placeholderTextColor={colors.muted} autoCapitalize="characters" autoCorrect={false} />
      <Text style={styles.label}>Shares</Text>
      <TextInput style={styles.field} value={shares} onChangeText={setShares} placeholder="10" placeholderTextColor={colors.muted} keyboardType="decimal-pad" />
      <Text style={styles.label}>Average cost per share (optional)</Text>
      <TextInput style={styles.field} value={cost} onChangeText={setCost} placeholder="150.00" placeholderTextColor={colors.muted} keyboardType="decimal-pad" />
      {msg && <Text style={styles.error}>{msg}</Text>}
      <PrimaryButton title="Add holding" icon="add" onPress={submit} loading={busy} style={{ marginTop: 14 }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: "#7C3AED", padding: 20, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginBottom: 6 },
  heroLabel: { color: "#E9D5FF", fontWeight: "700", fontSize: 14 },
  total: { color: colors.white, fontSize: 34, fontWeight: "800", marginTop: 6 },
  dayChange: { fontWeight: "800", fontSize: 15, marginTop: 2 },
  heroSub: { color: "#F3E8FF", fontSize: 14, marginTop: 6, lineHeight: 20 },
  heroActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  heroButton: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  heroButtonText: { color: colors.white, fontWeight: "700" },
  error: { color: colors.red, marginTop: 10 },
  empty: { alignItems: "center", padding: 28, backgroundColor: colors.card, borderRadius: 20, marginTop: 14 },
  emptyTitle: { fontWeight: "800", fontSize: 18, color: colors.text, marginTop: 10 },
  emptyText: { color: colors.muted, textAlign: "center", marginTop: 6, lineHeight: 20 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, backgroundColor: colors.bg, borderRadius: 12, padding: 10 },
  tileLabel: { color: colors.muted, fontSize: 11 },
  tileValue: { color: colors.text, fontSize: 17, fontWeight: "800", marginTop: 2 },
  tileHint: { color: xraySection.color, fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  subhead: { fontWeight: "800", color: colors.text, marginTop: 12, marginBottom: 4 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  barLabel: { width: 100, color: colors.text, fontSize: 13 },
  barTrack: { flex: 1, height: 10, backgroundColor: colors.border, borderRadius: 5, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 5 },
  barValue: { width: 46, textAlign: "right", fontWeight: "700", color: colors.text, fontSize: 13 },
  headline: { fontWeight: "800", fontSize: 16, color: colors.text, marginBottom: 6 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  inline: { flexDirection: "row", gap: 10, alignItems: "center" },
  earningRow: { flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  earningTicker: { fontWeight: "800", color: "#DB2777", width: 56 },
  sectionTitle: { fontWeight: "800", fontSize: 18, color: colors.text, marginTop: 22, marginBottom: 4 },
  holding: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderRadius: 18, padding: 12, marginTop: 10 },
  holdingTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  holdingName: { fontWeight: "800", color: colors.text, fontSize: 15 },
  holdingValue: { fontWeight: "800", color: colors.text },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  disclaimer: { color: colors.muted, fontSize: 11, marginTop: 20, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  // iOS has no "monospace" family (it errors in dev), so use Menlo there
  csvInput: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 12, minHeight: 140, marginTop: 10, fontSize: 14, color: colors.text, textAlignVertical: "top", fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  label: { fontWeight: "700", color: colors.text, marginTop: 12, marginBottom: 6 },
  field: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 16, color: colors.text },
});
