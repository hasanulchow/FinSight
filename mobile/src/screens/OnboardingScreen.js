import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { clearRef, storedRef } from "../lib/share";
import { LEGAL } from "../lib/legal";
import { makeStyles, useTheme } from "../theme";
import { Banner, Button, Chip, Input, Logo } from "../components/ui";

const EXPERIENCE = [
  ["new", "New to investing", "leaf-outline"],
  ["investor", "Long-term investor", "trending-up-outline"],
  ["active_trader", "Active trader", "flash-outline"],
  ["options_trader", "Options trader", "options-outline"],
];
const GOALS = [["long_term", "Build long-term wealth"], ["swing", "Swing trading"], ["day_trading", "Day trading"], ["options", "Options"], ["income", "Dividend income"], ["learn", "Learn the markets"]];
const POPULAR = ["AAPL", "NVDA", "MSFT", "TSLA", "AMZN", "META", "GOOGL", "SPY", "QQQ", "AMD"];

/** First run: accept the Terms + risk disclaimer, tell us about yourself, pick a watchlist. */
export default function OnboardingScreen({ onDone, onOpenLegal }) {
  const { c } = useTheme();
  const s = useStyles();
  const [step, setStep] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [experience, setExperience] = useState(null);
  const [goals, setGoals] = useState([]);
  const [watch, setWatch] = useState(["AAPL", "NVDA"]);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ref, setRef] = useState(null);

  useEffect(() => {
    storedRef().then(setRef);
    api.track("onboarding_step", { step: 0 });
  }, []);

  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const addCustom = () => {
    const t = custom.trim().toUpperCase();
    if (/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t) && !watch.includes(t)) setWatch([...watch, t].slice(0, 10));
    setCustom("");
  };
  const next = () => {
    api.track("onboarding_step", { step: step + 1 });
    setStep(step + 1);
  };

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.onboarding({ accept_terms: true, experience, goals, watchlist: watch, ref });
      await clearRef();
      onDone(r);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View style={s.top}>
        <Logo size={36} />
        <View style={s.dots}>
          {[0, 1, 2].map((i) => <View key={i} style={[s.dot, i <= step && { backgroundColor: c.primary, width: i === step ? 22 : 8 }]} />)}
        </View>
      </View>

      {step === 0 && (
        <View>
          <Text style={s.h1}>Before you start</Text>
          <Text style={s.lead}>FinSight is a research and learning tool. Please read the key points and accept to continue.</Text>
          <View style={s.card}>
            {LEGAL.disclaimer.sections.slice(0, 4).map(([h, body]) => (
              <View key={h} style={s.point}>
                <Ionicons name="shield-checkmark" size={18} color={c.primary} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={s.pointTitle}>{h}</Text>
                  <Text style={s.pointText}>{body}</Text>
                </View>
              </View>
            ))}
          </View>
          <Pressable onPress={() => setAccepted(!accepted)} style={s.check} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}>
            <Ionicons name={accepted ? "checkbox" : "square-outline"} size={24} color={accepted ? c.primary : c.muted} />
            <Text style={s.checkText}>
              I'm 18 or older and I agree to the{" "}
              <Text style={s.link} onPress={() => onOpenLegal("terms")}>Terms of Service</Text>,{" "}
              <Text style={s.link} onPress={() => onOpenLegal("privacy")}>Privacy Policy</Text> and{" "}
              <Text style={s.link} onPress={() => onOpenLegal("disclaimer")}>Risk Disclaimer</Text>.
            </Text>
          </Pressable>
          <Button title="Continue" iconRight="arrow-forward" size="lg" disabled={!accepted} onPress={next} style={{ marginTop: 18 }} />
        </View>
      )}

      {step === 1 && (
        <View>
          <Text style={s.h1}>How do you invest?</Text>
          <Text style={s.lead}>We'll tune the Copilot's explanations and your morning brief to you.</Text>
          <View style={s.grid}>
            {EXPERIENCE.map(([key, label, icon]) => {
              const on = experience === key;
              return (
                <Pressable key={key} onPress={() => setExperience(key)} style={[s.option, on && { borderColor: c.primary, backgroundColor: c.primarySoft }]}>
                  <Ionicons name={icon} size={22} color={on ? c.primary : c.textSecondary} />
                  <Text style={[s.optionText, on && { color: c.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={s.label}>What are you here for?</Text>
          <View style={s.chips}>
            {GOALS.map(([key, label]) => <Chip key={key} label={label} active={goals.includes(key)} onPress={() => toggle(goals, setGoals, key)} />)}
          </View>
          <View style={s.row}>
            <Button title="Back" variant="ghost" onPress={() => setStep(0)} />
            <Button title="Continue" iconRight="arrow-forward" onPress={next} style={{ flex: 1 }} />
          </View>
        </View>
      )}

      {step === 2 && (
        <View>
          <Text style={s.h1}>Build your watchlist</Text>
          <Text style={s.lead}>Every morning FinSight checks these for big moves, earnings, filings, insider trades and red flags, and sends you a brief.</Text>
          <View style={s.chips}>
            {[...new Set([...POPULAR, ...watch])].map((t) => <Chip key={t} label={t} active={watch.includes(t)} onPress={() => toggle(watch, setWatch, t)} />)}
          </View>
          <Input value={custom} onChangeText={setCustom} placeholder="Add another ticker" autoCapitalize="characters" onSubmitEditing={addCustom} right={<Button title="Add" size="sm" variant="secondary" onPress={addCustom} />} style={{ marginTop: 14 }} />
          {ref && <Banner tone="success" icon="gift">Invite code {ref} applied: you'll get free Pro days when you finish.</Banner>}
          {error && <Banner tone="error">{error}</Banner>}
          <View style={s.row}>
            <Button title="Back" variant="ghost" onPress={() => setStep(1)} />
            <Button title={`Start with ${watch.length} stock${watch.length === 1 ? "" : "s"}`} icon="rocket" onPress={finish} loading={busy} style={{ flex: 1 }} />
          </View>
        </View>
      )}

    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 22, paddingBottom: 60, maxWidth: 640, width: "100%", alignSelf: "center" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 28 },
  dots: { flexDirection: "row", gap: 6 },
  dot: { height: 8, width: 8, borderRadius: 4, backgroundColor: c.border },
  h1: { color: c.text, fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  lead: { color: c.textSecondary, fontSize: 16, lineHeight: 23, marginTop: 8 },
  card: { backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 16, marginTop: 18, gap: 14 },
  point: { flexDirection: "row", gap: 12 },
  pointTitle: { color: c.text, fontWeight: "800", fontSize: 14 },
  pointText: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 2 },
  check: { flexDirection: "row", gap: 12, alignItems: "flex-start", marginTop: 18 },
  checkText: { flex: 1, color: c.text, fontSize: 14, lineHeight: 21 },
  link: { color: c.primary, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 20 },
  option: { flexBasis: "47%", flexGrow: 1, borderWidth: 1.5, borderColor: c.border, borderRadius: 16, padding: 16, gap: 10, backgroundColor: c.surface },
  optionText: { color: c.textSecondary, fontWeight: "700", fontSize: 15 },
  label: { color: c.text, fontWeight: "800", fontSize: 15, marginTop: 24, marginBottom: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  row: { flexDirection: "row", gap: 10, marginTop: 24 },
}));
