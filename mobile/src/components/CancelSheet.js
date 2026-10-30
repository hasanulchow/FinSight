import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Button, Input } from "./ui";
import { ErrorNotice } from "./Upgrade";
import Sheet from "./Sheet";

/** Cancel flow: ask why, offer a fitting alternative (pause, discount, yearly), then cancel at period end. */
export default function CancelSheet({ visible, onClose, onDone, onSwitchAnnual }) {
  const { c } = useTheme();
  const s = useStyles();
  const [reasons, setReasons] = useState([]);
  const [reason, setReason] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setFeedback("");
    setResult(null);
    setError(null);
    api.cancelReasons().then(setReasons).catch(setError);
  }, [visible]);

  const offer = reasons.find((r) => r.key === reason)?.offer;

  async function act(action) {
    if (action === "annual") return onSwitchAnnual?.();
    setBusy(action);
    setError(null);
    try {
      const r = await api.cancelFlow({ action, reason, feedback });
      setResult({ action, ...r });
      onDone?.();
    } catch (e) {
      setError(e);
    }
    setBusy(null);
  }

  return (
    <Sheet visible={visible} onClose={onClose} eyebrow="Manage plan" title={result ? "All set" : "Before you go"}>
      {result ? (
        <View style={s.done}>
          <Ionicons name={result.action === "cancel" ? "calendar-outline" : "heart"} size={40} color={c.primary} />
          <Text style={s.doneText}>
            {result.action === "pause" ? "Billing is paused for a month. Your data stays put; Pro comes back when billing resumes."
              : result.action === "discount" ? "Your discount is applied to the next invoices. Thanks for staying!"
              : "Your plan stays active until the end of this billing period, then switches to Free. You can resume anytime before then."}
          </Text>
          <Button title="Done" onPress={onClose} size="lg" style={{ marginTop: 16, alignSelf: "stretch" }} />
        </View>
      ) : (
        <>
          <Text style={s.lead}>What's the main reason you want to cancel?</Text>
          {reasons.map((r) => (
            <Pressable key={r.key} onPress={() => setReason(r.key)} style={[s.reason, reason === r.key && { borderColor: c.primary, backgroundColor: c.primarySoft }]} accessibilityRole="radio" accessibilityState={{ selected: reason === r.key }}>
              <Ionicons name={reason === r.key ? "radio-button-on" : "radio-button-off"} size={18} color={reason === r.key ? c.primary : c.muted} />
              <Text style={s.reasonText}>{r.label}</Text>
            </Pressable>
          ))}
          {reason && (
            <Input value={feedback} onChangeText={setFeedback} placeholder="Anything we could do better? (optional)" multiline inputStyle={{ minHeight: 60 }} style={{ marginTop: 12 }} />
          )}
          {offer && (
            <View style={s.offer}>
              <Text style={s.offerTitle}>{offer.label}</Text>
              <Text style={s.offerText}>{offer.detail}</Text>
              <Button title={offer.label} icon="gift-outline" onPress={() => act(offer.kind)} loading={busy === offer.kind} style={{ marginTop: 10 }} />
            </View>
          )}
          <ErrorNotice error={error} />
          <Button title="Cancel my subscription" variant="danger" onPress={() => act("cancel")} loading={busy === "cancel"} disabled={!reason} style={{ marginTop: 16 }} />
          <Button title="Keep Pro" variant="ghost" onPress={onClose} style={{ marginTop: 8 }} />
        </>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  lead: { color: c.text, fontSize: 15, fontWeight: "700", marginBottom: 10 },
  reason: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, marginTop: 8 },
  reasonText: { color: c.text, fontSize: 14, flex: 1 },
  offer: { marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: c.primarySoft },
  offerTitle: { color: c.text, fontWeight: "800", fontSize: 15 },
  offerText: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  done: { alignItems: "center", paddingVertical: 12 },
  doneText: { color: c.text, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 12 },
}));
