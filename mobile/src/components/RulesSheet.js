import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Button, Chip, Input, Loading } from "./ui";
import { ErrorNotice } from "./Upgrade";
import Sheet from "./Sheet";

/** Edit the user's trading rules; the journal checks new trades against them. `suggestions` are the coach's rules. */
export default function RulesSheet({ visible, onClose, onSaved, suggestions = [] }) {
  const { c } = useTheme();
  const s = useStyles();
  const [defs, setDefs] = useState(null);
  const [rules, setRules] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    api.rules().then((r) => {
      setDefs(r.definitions);
      setRules(r.rules ?? {});
    }).catch(setError);
  }, [visible]);

  const set = (k, v) => setRules((r) => ({ ...r, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, defs[k]?.type === "number" && v !== "" && v != null ? Number(v) : v]));
      await api.saveRules(clean);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  return (
    <Sheet visible={visible} onClose={onClose} eyebrow="Pre-trade checklist" title="Your trading rules">
      <Text style={s.lead}>Every trade you log is checked against these. You'll see a warning if one is broken, and you can still log it.</Text>
      {suggestions.length > 0 && (
        <View style={s.suggest}>
          <Text style={s.suggestTitle}>Your coach suggested</Text>
          {suggestions.map((r, i) => <Text key={i} style={s.suggestText}>• {r}</Text>)}
        </View>
      )}
      {!defs && !error && <Loading />}
      {defs && Object.entries(defs).map(([key, def]) => (
        <View key={key} style={s.rule}>
          <Text style={s.ruleLabel}>{def.label}</Text>
          {def.type === "boolean" && <Switch value={!!rules[key]} onValueChange={(v) => set(key, v)} trackColor={{ true: c.primary, false: c.borderStrong }} />}
          {def.type === "number" && (
            <Input value={rules[key] != null ? String(rules[key]) : ""} onChangeText={(v) => set(key, v === "" ? undefined : v)} keyboardType="decimal-pad" placeholder="off" style={{ width: 110 }} inputStyle={{ paddingVertical: 9, textAlign: "right" }} />
          )}
          {def.type === "list" && (
            <View style={s.chips}>
              {def.options.map((o) => {
                const list = rules[key] ?? [];
                const on = list.includes(o);
                return <Chip key={o} label={o} active={on} onPress={() => set(key, on ? list.filter((x) => x !== o) : [...list, o])} />;
              })}
            </View>
          )}
        </View>
      ))}
      <ErrorNotice error={error} />
      <Button title="Save rules" icon="checkmark" onPress={save} loading={busy} disabled={!defs} size="lg" style={{ marginTop: 16 }} />
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  lead: { color: c.textSecondary, fontSize: 14, lineHeight: 20 },
  suggest: { backgroundColor: c.primarySoft, borderRadius: 12, padding: 12, marginTop: 12 },
  suggestTitle: { color: c.primary, fontWeight: "800", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  suggestText: { color: c.text, fontSize: 13, lineHeight: 19 },
  rule: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border, marginTop: 4 },
  ruleLabel: { flex: 1, minWidth: 180, color: c.text, fontSize: 14, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, width: "100%" },
}));
