import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { colors } from "../theme";
import { PrimaryButton, TickerAvatar } from "../components/ui";
import TechnicalsCard from "../components/TechnicalsCard";
import EventsCard from "../components/EventsCard";
import AlertSheet from "../components/AlertSheet";

/** Quick stock view: chart + technicals (AI read on demand), earnings & insiders, alert and briefing actions. */
export default function StockScreen({ ticker, onBack, onBrief }) {
  const [tech, setTech] = useState(null);
  const [techError, setTechError] = useState(null);
  const [explaining, setExplaining] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [briefing, setBriefing] = useState(false);

  useEffect(() => {
    api.technicals(ticker).then(setTech).catch((e) => setTechError(e.message));
  }, [ticker]);

  async function explain() {
    setExplaining(true);
    try {
      const withAi = await api.technicals(ticker, { explain: true });
      setTech(withAi);
    } catch (e) {
      setToast(e.message);
    }
    setExplaining(false);
  }

  async function brief() {
    setBriefing(true);
    try {
      await onBrief(ticker);
    } catch (e) {
      setToast(e.message);
      setBriefing(false);
    }
  }

  const s = tech?.snapshot;
  const change = s?.change_1d_pct;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Pressable onPress={onBack} style={styles.back} hitSlop={10}>
        <Ionicons name="arrow-back" size={20} color={colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <View style={styles.hero}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TickerAvatar ticker={ticker} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={styles.ticker}>{ticker}</Text>
            {s && (
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text style={styles.price}>${s.price}</Text>
                {change != null && <Text style={{ color: change >= 0 ? colors.green : colors.red, fontWeight: "800" }}>{change >= 0 ? "+" : ""}{change}%</Text>}
              </View>
            )}
          </View>
        </View>
        <View style={styles.actions}>
          <PrimaryButton title="Full AI briefing" icon="sparkles" onPress={brief} loading={briefing} style={{ flex: 1 }} />
          <Pressable style={styles.alertButton} onPress={() => setAlertOpen(true)} accessibilityLabel="Create alert">
            <Ionicons name="notifications-outline" size={22} color={colors.primary} />
          </Pressable>
        </View>
        {toast && <Text style={styles.toast}>{toast}</Text>}
      </View>

      {!tech && !techError && (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Loading chart…</Text>
        </View>
      )}
      {techError && <Text style={[styles.muted, { marginTop: 14 }]}>Chart unavailable: {techError}</Text>}
      {tech && <TechnicalsCard snapshot={tech.snapshot} chart={tech.chart} analysis={tech.analysis} onExplain={explain} explaining={explaining} />}

      <EventsCard ticker={ticker} />

      <Text style={styles.disclaimer}>Educational information from market data and SEC filings, not investment advice.</Text>

      <AlertSheet ticker={ticker} price={s?.price} visible={alertOpen} onClose={() => setAlertOpen(false)} onCreated={() => setToast("Alert created. Find it in the Alerts tab.")} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, alignSelf: "flex-start" },
  backText: { color: colors.primary, fontWeight: "700", fontSize: 16 },
  hero: { backgroundColor: colors.card, borderRadius: 22, padding: 18, marginTop: 8, shadowColor: "#1E1B4B", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  ticker: { fontSize: 24, fontWeight: "800", color: colors.text },
  price: { fontSize: 22, fontWeight: "800", color: colors.text },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  alertButton: { width: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  toast: { color: colors.primaryDark, backgroundColor: colors.primarySoft, borderRadius: 10, padding: 10, marginTop: 10 },
  loading: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 20, justifyContent: "center" },
  muted: { color: colors.muted },
  disclaimer: { color: colors.muted, fontSize: 11, marginTop: 20, textAlign: "center" },
});
