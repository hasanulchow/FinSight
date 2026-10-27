import { useCallback, useEffect, useState } from "react";
import { Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { formatMoney, makeStyles, useTheme } from "../theme";
import BenchmarkCard from "../components/BenchmarkCard";
import BrokerCard from "../components/BrokerCard";
import { UpgradeCard } from "../components/Upgrade";
import { Banner, Bullets, Button, Disclaimer, EmptyState, Input, Loading, PageHeader, Pill, SectionCard, Stat, TickerAvatar } from "../components/ui";

const CSV_EXAMPLE = "Symbol,Quantity,Average Cost\nAAPL,10,150\nMSFT,5,300\nNVDA,20,";
const DONUT_HUES = ["indigo", "sky", "emerald", "amber", "rose", "violet", "teal", "orange", "fuchsia", "blue"];

/** Portfolio X-ray: holdings, allocation, concentration, chart health, upcoming earnings, AI read. */
export default function PortfolioScreen({ onOpenStock, onOpenTax }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const sec = sections.portfolio;
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
  const RISK = { low: c.gain, moderate: c.warn, elevated: c.hue("orange"), high: c.loss };
  const up = (xray?.day_change ?? 0) >= 0;

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={loading && !!xray} onRefresh={load} tintColor={c.primary} />}>
      <PageHeader
        eyebrow="Portfolio X-ray"
        title={xray && !empty ? formatMoney(xray.total_value) : "Your portfolio"}
        subtitle={xray && !empty ? null : "See concentration, sector exposure, chart health and upcoming earnings across everything you own."}
        right={
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Import" icon="cloud-upload-outline" variant="secondary" size="sm" onPress={() => setImportOpen(true)} />
            <Button title="Add" icon="add" size="sm" onPress={() => setAddOpen(true)} />
          </View>
        }
      />
      {xray && !empty && (
        <View style={s.dayRow}>
          <View style={[s.change, { backgroundColor: c.soft(up ? c.gain : c.loss) }]}>
            <Ionicons name={up ? "caret-up" : "caret-down"} size={12} color={up ? c.gain : c.loss} />
            <Text style={[s.changeText, { color: up ? c.gain : c.loss }]}>{formatMoney(Math.abs(xray.day_change))} ({Math.abs(xray.day_change_pct)}%) today</Text>
          </View>
          {xray.unrealized_pl != null && (
            <Text style={s.muted}>Unrealized {xray.unrealized_pl >= 0 ? "+" : "-"}{formatMoney(Math.abs(xray.unrealized_pl))} ({xray.unrealized_pl_pct}%)</Text>
          )}
        </View>
      )}

      {loading && !xray && <Loading text="Pricing your holdings…" />}
      {error && <Banner tone="error">{error}</Banner>}

      <BrokerCard onSynced={load} />

      {empty && (
        <EmptyState
          icon="pie-chart-outline"
          title="Add your portfolio"
          text="Export positions from your broker as CSV and paste them in, or add holdings one by one. Prices and charts update automatically."
          action={<Button title="Import CSV" icon="cloud-upload-outline" onPress={() => setImportOpen(true)} />}
        />
      )}

      {xray && !empty && (
        <>
          <SectionCard title="Allocation" section={sec} right={a?.risk_level ? <Pill text={`${a.risk_level} risk`} color={RISK[a.risk_level]} /> : null}>
            <View style={s.allocation}>
              <Donut sectors={xray.sectors} />
              <View style={{ flex: 1, gap: 7 }}>
                {xray.sectors.slice(0, 7).map((x, i) => (
                  <View key={x.sector} style={s.legendRow}>
                    <View style={[s.legendDot, { backgroundColor: c.hue(DONUT_HUES[i % DONUT_HUES.length]) }]} />
                    <Text style={s.legendName} numberOfLines={1}>{x.sector}</Text>
                    <Text style={s.legendPct}>{x.weight}%</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={[s.stats, { marginTop: 16 }]}>
              <Stat label="Largest holding" value={`${xray.concentration.top_holding_pct}%`} />
              <Stat label="Top 3" value={`${xray.concentration.top3_pct}%`} />
              <Stat label="Acts like" value={`${xray.concentration.effective_holdings} stocks`} hint={xray.concentration.diversification} />
            </View>
          </SectionCard>

          <BenchmarkCard refreshKey={xray.positions?.length} />

          {onOpenTax && (
            <Pressable onPress={onOpenTax} style={({ hovered }) => [s.taxLink, hovered && { borderColor: sections.redflags.color }]}>
              <View style={[s.taxIcon, { backgroundColor: sections.redflags.soft }]}>
                <Ionicons name="receipt-outline" size={18} color={sections.redflags.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.taxTitle}>Tax center</Text>
                <Text style={s.muted}>Realized gains, wash sales and tax-loss harvesting ideas</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.muted} />
            </Pressable>
          )}

          <SectionCard title="AI X-ray" section={{ ...sec, icon: "sparkles-outline" }}>
            {a ? (
              <>
                <Text style={s.headline}>{a.headline}</Text>
                <Text style={s.body}>{a.summary}</Text>
                {[["Concentration", a.concentration], ["Sector exposure", a.sector_exposure], ["Chart health", a.technical_health], ["Coming up", a.upcoming]].map(([h, t]) => (
                  <View key={h}>
                    <Text style={s.subhead}>{h}</Text>
                    <Text style={s.body}>{t}</Text>
                  </View>
                ))}
                <Text style={s.subhead}>Things to watch</Text>
                <Bullets items={a.things_to_watch} color={sec.color} />
              </>
            ) : analyzing ? (
              <Loading text="Analyzing your portfolio…" />
            ) : xray.upgrade ? (
              <UpgradeCard text={xray.analysis_error} />
            ) : (
              <Text style={s.muted}>{xray.analysis_error ?? "AI analysis unavailable right now. Pull to refresh."}</Text>
            )}
          </SectionCard>

          {xray.upcoming_earnings?.length > 0 && (
            <SectionCard title="Earnings in the next 30 days" section={sections.events}>
              {xray.upcoming_earnings.map((e) => (
                <Pressable key={e.ticker + e.date} style={s.earningRow} onPress={() => onOpenStock(e.ticker)}>
                  <TickerAvatar ticker={e.ticker} size={34} />
                  <Text style={[s.body, { flex: 1 }]}>{new Date(`${e.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</Text>
                  <Text style={s.muted}>{e.hour === "bmo" ? "Before open" : e.hour === "amc" ? "After close" : ""}</Text>
                </Pressable>
              ))}
            </SectionCard>
          )}

          <Text style={s.sectionTitle}>Holdings</Text>
          {xray.positions.map((p) => (
            <Pressable key={p.id} style={({ hovered, pressed }) => [s.holding, hovered && { borderColor: c.borderStrong }, pressed && { opacity: 0.85 }]} onPress={() => onOpenStock(p.ticker)}>
              <TickerAvatar ticker={p.ticker} size={44} />
              <View style={{ flex: 1 }}>
                <View style={s.holdingTop}>
                  <Text style={s.holdingName} numberOfLines={1}>{p.ticker}</Text>
                  <Text style={s.holdingValue}>{formatMoney(p.value)}</Text>
                </View>
                <View style={s.holdingTop}>
                  <Text style={s.muted}>{p.shares} sh · {p.weight}%</Text>
                  <Text style={{ color: (p.change_pct ?? 0) >= 0 ? c.gain : c.loss, fontWeight: "700", fontSize: 13 }}>{p.change_pct >= 0 ? "+" : ""}{p.change_pct}%</Text>
                </View>
                <View style={s.weightTrack}><View style={[s.weightFill, { width: `${Math.min(100, p.weight)}%` }]} /></View>
                <View style={s.tags}>
                  {p.pl_pct != null && <Pill text={`P/L ${p.pl_pct >= 0 ? "+" : ""}${p.pl_pct}%`} color={p.pl_pct >= 0 ? c.gain : c.loss} />}
                  {p.technicals?.trend && <Pill text={p.technicals.trend} color={p.technicals.trend === "uptrend" ? c.gain : p.technicals.trend === "downtrend" ? c.loss : c.muted} />}
                  {p.technicals?.rsi14 != null && (p.technicals.rsi14 >= 70 || p.technicals.rsi14 <= 30) && <Pill text={`RSI ${p.technicals.rsi14}`} color={c.warn} />}
                </View>
              </View>
              <Pressable onPress={() => remove(p.id)} hitSlop={10} accessibilityLabel={`Remove ${p.ticker}`} style={s.remove}>
                <Ionicons name="trash-outline" size={17} color={c.muted} />
              </Pressable>
            </Pressable>
          ))}
          {xray.unpriced?.length > 0 && <Text style={[s.muted, { marginTop: 10 }]}>No price found for: {xray.unpriced.join(", ")}</Text>}
          <Disclaimer>Educational analysis, not investment advice. Holdings stay private to your account.</Disclaimer>
        </>
      )}

      <ImportModal visible={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
      <AddModal visible={addOpen} onClose={() => setAddOpen(false)} onDone={load} />
    </ScrollView>
  );
}

/** Sector allocation donut (SVG arcs drawn with stroke dash offsets). */
function Donut({ sectors, size = 132 }) {
  const { c } = useTheme();
  const stroke = 18;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.surfaceAlt} strokeWidth={stroke} fill="none" />
        {sectors.map((x, i) => {
          const len = (x.weight / 100) * circ;
          const el = <Circle key={x.sector} cx={size / 2} cy={size / 2} r={r} stroke={c.hue(DONUT_HUES[i % DONUT_HUES.length])} strokeWidth={stroke} fill="none" strokeDasharray={`${Math.max(0, len - 2)} ${circ}`} strokeDashoffset={-offset} strokeLinecap="butt" />;
          offset += len;
          return el;
        })}
      </Svg>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: c.text, fontSize: 20, fontWeight: "800" }}>{sectors.length}</Text>
        <Text style={{ color: c.muted, fontSize: 11 }}>sectors</Text>
      </View>
    </View>
  );
}

function Sheet({ visible, onClose, title, children }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <Modal supportedOrientations={["portrait", "landscape"]} visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.sheetWrap}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} accessibilityLabel="Close" style={s.close}><Ionicons name="close" size={20} color={c.textSecondary} /></Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function ImportModal({ visible, onClose, onDone }) {
  const { c } = useTheme();
  const s = useStyles();
  const [csv, setCsv] = useState("");
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      await api.importCsv(csv, replace ? "replace" : "merge");
      setCsv("");
      onDone();
      onClose();
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Import from CSV">
      <Text style={s.muted}>Paste your broker's positions export. Columns like Symbol, Quantity and Average Cost are detected automatically; simple lines like "AAPL,10,150" work too.</Text>
      <TextInput style={s.csvInput} multiline value={csv} onChangeText={setCsv} placeholder={CSV_EXAMPLE} placeholderTextColor={c.muted} autoCapitalize="characters" autoCorrect={false} />
      <Pressable style={s.checkRow} onPress={() => setReplace(!replace)}>
        <Ionicons name={replace ? "checkbox" : "square-outline"} size={20} color={c.primary} />
        <Text style={s.body}>Replace my current holdings</Text>
      </Pressable>
      {msg && <Banner tone="error">{msg}</Banner>}
      <Button title="Import" icon="cloud-upload-outline" onPress={submit} loading={busy} disabled={!csv.trim()} size="lg" style={{ marginTop: 14 }} />
    </Sheet>
  );
}

function AddModal({ visible, onClose, onDone }) {
  const s = useStyles();
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
      <Text style={s.label}>Ticker</Text>
      <Input value={ticker} onChangeText={setTicker} placeholder="AAPL" autoCapitalize="characters" autoCorrect={false} />
      <Text style={s.label}>Shares</Text>
      <Input value={shares} onChangeText={setShares} placeholder="10" keyboardType="decimal-pad" />
      <Text style={s.label}>Average cost per share (optional)</Text>
      <Input value={cost} onChangeText={setCost} placeholder="150.00" keyboardType="decimal-pad" />
      {msg && <Banner tone="error">{msg}</Banner>}
      <Button title="Add holding" icon="add" onPress={submit} loading={busy} size="lg" style={{ marginTop: 16 }} />
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  taxLink: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, marginTop: 14 },
  taxIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  taxTitle: { color: c.text, fontWeight: "800", fontSize: 15 },
  scroll: { padding: 16, paddingBottom: 60 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: -6, marginBottom: 4 },
  change: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  changeText: { fontWeight: "800", fontVariant: ["tabular-nums"] },
  muted: { color: c.textSecondary, fontSize: 13, lineHeight: 19 },
  body: { color: c.text, fontSize: 14, lineHeight: 21 },
  headline: { fontWeight: "800", fontSize: 16, color: c.text, marginBottom: 6 },
  subhead: { fontWeight: "700", color: c.text, marginTop: 14, marginBottom: 4, fontSize: 13 },
  allocation: { flexDirection: "row", alignItems: "center", gap: 20 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendName: { flex: 1, color: c.text, fontSize: 13 },
  legendPct: { color: c.textSecondary, fontWeight: "700", fontSize: 13, fontVariant: ["tabular-nums"] },
  stats: { flexDirection: "row", gap: 8 },
  earningRow: { flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  sectionTitle: { fontWeight: "800", fontSize: 18, color: c.text, marginTop: 24, marginBottom: 2, letterSpacing: -0.2 },
  holding: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 14, marginTop: 10 },
  holdingTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  holdingName: { fontWeight: "800", color: c.text, fontSize: 15 },
  holdingValue: { fontWeight: "800", color: c.text, fontVariant: ["tabular-nums"] },
  weightTrack: { height: 4, borderRadius: 2, backgroundColor: c.surfaceAlt, marginTop: 8, overflow: "hidden" },
  weightFill: { height: 4, borderRadius: 2, backgroundColor: c.primary },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  remove: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sheetWrap: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay },
  sheet: { width: "100%", maxWidth: 560, backgroundColor: c.elevated, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, paddingBottom: 32, borderWidth: 1, borderColor: c.border },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: c.text },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" },
  // iOS has no "monospace" family (it errors in dev), so use Menlo there
  csvInput: { borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt, borderRadius: 14, padding: 12, minHeight: 140, marginTop: 12, fontSize: 14, color: c.text, textAlignVertical: "top", fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  label: { fontWeight: "600", color: c.text, marginTop: 14, marginBottom: 8, fontSize: 14 },
}));
