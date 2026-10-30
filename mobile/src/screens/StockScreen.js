import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { BackButton, Banner, Button, Disclaimer, Loading, TickerAvatar } from "../components/ui";
import TechnicalsCard from "../components/TechnicalsCard";
import EventsCard from "../components/EventsCard";
import AlertSheet from "../components/AlertSheet";
import RedFlagsCard from "../components/RedFlagsCard";
import PositionSizerSheet from "../components/PositionSizerSheet";
import OrderSheet from "../components/OrderSheet";
import EarningsSheet from "../components/EarningsSheet";

/** Quick stock view: chart + technicals (AI read on demand), earnings & insiders, and actions. */
export default function StockScreen({ ticker, onBack, onBrief, onOptions, onBacktest }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [tech, setTech] = useState(null);
  const [techError, setTechError] = useState(null);
  const [explaining, setExplaining] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [sizerOpen, setSizerOpen] = useState(false);
  const [orderSide, setOrderSide] = useState(null);
  const [earningsOpen, setEarningsOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [briefing, setBriefing] = useState(false);

  useEffect(() => {
    api.technicals(ticker).then(setTech).catch((e) => setTechError(e.message));
  }, [ticker]);

  async function explain() {
    setExplaining(true);
    try {
      setTech(await api.technicals(ticker, { explain: true }));
    } catch (e) {
      setToast({ tone: "error", text: e.message });
    }
    setExplaining(false);
  }

  async function brief() {
    setBriefing(true);
    try {
      await onBrief(ticker);
    } catch (e) {
      setToast({ tone: "error", text: e.message });
      setBriefing(false);
    }
  }

  const snap = tech?.snapshot;
  const change = snap?.change_1d_pct;
  const up = (change ?? 0) >= 0;

  const tools = [
    { key: "options", label: "Options", sub: "IV, expected move, strategies", section: sections.options, onPress: () => onOptions(ticker) },
    { key: "backtest", label: "Backtest", sub: "Test trading rules", section: sections.backtest, onPress: () => onBacktest(ticker) },
    { key: "size", label: "Size it", sub: "Shares for your risk", section: sections.risk, onPress: () => setSizerOpen(true) },
    { key: "alert", label: "Alert", sub: "Price, RSI, earnings…", section: sections.alerts, onPress: () => setAlertOpen(true) },
    { key: "earnings", label: "Earnings", sub: "Implied vs past moves", section: sections.events, onPress: () => setEarningsOpen(true) },
  ];

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <BackButton onPress={onBack} />

      <View style={s.hero}>
        <View style={s.heroTop}>
          <TickerAvatar ticker={ticker} size={54} />
          <View style={{ flex: 1 }}>
            <Text style={s.ticker}>{ticker}</Text>
            {snap ? (
              <View style={s.priceRow}>
                <Text style={s.price}>${snap.price}</Text>
                {change != null && (
                  <View style={[s.change, { backgroundColor: c.soft(up ? c.gain : c.loss) }]}>
                    <Ionicons name={up ? "caret-up" : "caret-down"} size={12} color={up ? c.gain : c.loss} />
                    <Text style={[s.changeText, { color: up ? c.gain : c.loss }]}>{Math.abs(change)}%</Text>
                  </View>
                )}
              </View>
            ) : (
              <Text style={s.muted}>Loading price…</Text>
            )}
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          <Button title="Buy" onPress={() => setOrderSide("buy")} size="lg" style={{ flex: 1, backgroundColor: c.gain }} />
          <Button title="Sell" onPress={() => setOrderSide("sell")} size="lg" style={{ flex: 1, backgroundColor: c.loss }} />
        </View>
        <Text style={[s.muted, { textAlign: "center", marginTop: 6, fontSize: 12 }]}>Practice trading with paper money</Text>
        <Button title="Full AI briefing" icon="sparkles" variant="secondary" onPress={brief} loading={briefing} size="lg" style={{ marginTop: 12 }} />
        <View style={s.tools}>
          {tools.map((t) => (
            <Pressable key={t.key} onPress={t.onPress} style={({ hovered, pressed }) => [s.tool, hovered && { borderColor: t.section.color }, pressed && { opacity: 0.85 }]}>
              <View style={[s.toolIcon, { backgroundColor: t.section.soft }]}>
                <Ionicons name={t.section.icon} size={18} color={t.section.color} />
              </View>
              <Text style={s.toolTitle}>{t.label}</Text>
              <Text style={s.toolSub} numberOfLines={1}>{t.sub}</Text>
            </Pressable>
          ))}
        </View>
        {toast && <Banner tone={toast.tone}>{toast.text}</Banner>}
      </View>

      {!tech && !techError && <Loading text="Loading chart and indicators…" />}
      {techError && <Banner tone="warn">Chart unavailable: {techError}</Banner>}
      {tech && <TechnicalsCard snapshot={tech.snapshot} chart={tech.chart} analysis={tech.analysis} onExplain={explain} explaining={explaining} />}

      <RedFlagsCard ticker={ticker} />

      <EventsCard ticker={ticker} />

      <Disclaimer>Educational information from market data and SEC filings, not investment advice.</Disclaimer>

      <OrderSheet visible={!!orderSide} onClose={() => setOrderSide(null)} ticker={ticker} side={orderSide ?? "buy"} mode="paper" onPlaced={(o) => setToast({ tone: "success", text: o.status === "filled" ? `Paper order filled at ${Number(o.filled_price).toFixed(2)}. See it in Trade.` : "Paper order placed. See it in Trade." })} />
      <EarningsSheet ticker={ticker} visible={earningsOpen} onClose={() => setEarningsOpen(false)} />
      <PositionSizerSheet ticker={ticker} price={snap?.price} visible={sizerOpen} onClose={() => setSizerOpen(false)} />
      <AlertSheet ticker={ticker} price={snap?.price} visible={alertOpen} onClose={() => setAlertOpen(false)} onCreated={() => setToast({ tone: "success", text: "Alert created. Find it in the Alerts tab." })} />
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  hero: { backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 20, marginTop: 8 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  ticker: { fontSize: 15, fontWeight: "700", color: c.textSecondary, letterSpacing: 0.4 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
  price: { fontSize: 32, fontWeight: "800", color: c.text, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  change: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  changeText: { fontWeight: "800", fontVariant: ["tabular-nums"] },
  muted: { color: c.muted, marginTop: 4 },
  tools: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  tool: { flex: 1, flexBasis: 130, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 12, backgroundColor: c.surfaceAlt },
  toolIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  toolTitle: { color: c.text, fontWeight: "800", fontSize: 14 },
  toolSub: { color: c.muted, fontSize: 11, marginTop: 2 },
}));
