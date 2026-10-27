import { useCallback, useEffect, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { BackButton, Button, Chip, EmptyState, Input, Loading, PageHeader, Segmented } from "../components/ui";
import { ErrorNotice } from "../components/Upgrade";
import Sheet from "../components/Sheet";

const IDEAS = [
  "Every weekday morning, check my watchlist for anything oversold near support",
  "Every Friday, summarize how my portfolio did vs SPY this week",
  "Every Monday, list earnings coming up this week for my holdings and watchlist",
  "Every day after the close, flag any new insider buying in my watchlist",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Times are picked in local time and stored in UTC
const offsetHours = () => -new Date().getTimezoneOffset() / 60;
const toUtc = (h) => (((h - offsetHours()) % 24) + 24) % 24;
const toLocal = (h) => (((h + offsetHours()) % 24) + 24) % 24;
// Weekday in local time for a task stored as (weekday, hour) in UTC
const localDay = (t) => {
  const raw = t.hour_utc + offsetHours();
  return (t.weekday + (raw >= 24 ? 1 : raw < 0 ? -1 : 0) + 7) % 7;
};
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

/** Automations: Copilot prompts that run on a schedule and notify you with the answer. */
export default function AutomationsScreen({ onBack }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [running, setRunning] = useState(null);

  const load = useCallback(() => api.automations().then(setTasks).catch(setError), []);
  useEffect(() => {
    load();
  }, [load]);

  async function toggle(t) {
    setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, enabled: !t.enabled } : x)));
    await api.updateAutomation(t.id, { enabled: !t.enabled }).catch(setError);
  }

  async function runNow(t) {
    setRunning(t.id);
    setError(null);
    try {
      const row = await api.runAutomation(t.id);
      setTasks((all) => all.map((x) => (x.id === row.id ? row : x)));
    } catch (e) {
      setError(e);
    }
    setRunning(null);
  }

  const when = (t) => {
    const h = toLocal(t.hour_utc);
    return `${t.frequency === "weekly" ? `Every ${DAYS[localDay(t)]}` : t.frequency === "weekdays" ? "Weekdays" : "Every day"} at ${hourLabel(h)}`;
  };

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      {onBack && <BackButton onPress={onBack} />}
      <PageHeader eyebrow="Copilot" title="Automations" subtitle="Give the Copilot a job and a schedule. It does the research and sends you the answer." right={<Button title="New" icon="add" size="sm" onPress={() => setEditing({})} />} />
      <ErrorNotice error={error} />
      {!tasks && !error && <Loading />}
      {tasks && !tasks.length && <EmptyState icon="timer-outline" title="No automations yet" text="Try one of the ideas below, or write your own." />}
      {tasks?.map((t) => (
        <View key={t.id} style={s.card}>
          <View style={s.cardHead}>
            <View style={[s.icon, { backgroundColor: sections.copilot.soft }]}>
              <Ionicons name="timer-outline" size={18} color={sections.copilot.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{t.title}</Text>
              <Text style={s.muted}>{when(t)}{t.next_run_at && t.enabled ? ` · next ${new Date(t.next_run_at).toLocaleString(undefined, { weekday: "short", hour: "numeric" })}` : ""}</Text>
            </View>
            <Switch value={t.enabled} onValueChange={() => toggle(t)} trackColor={{ true: c.primary, false: c.borderStrong }} />
          </View>
          {t.last_result && (
            <View style={[s.result, t.last_status === "error" && { backgroundColor: c.lossSoft }]}>
              <Text style={s.resultLabel}>{t.last_status === "error" ? "Last run failed" : `Last run · ${new Date(t.last_run_at).toLocaleString()}`}</Text>
              <Text style={s.resultText} numberOfLines={6}>{t.last_result}</Text>
            </View>
          )}
          <View style={s.actions}>
            <Button title="Run now" icon="play" size="sm" variant="secondary" onPress={() => runNow(t)} loading={running === t.id} />
            <Button title="Edit" icon="create-outline" size="sm" variant="ghost" onPress={() => setEditing(t)} />
          </View>
        </View>
      ))}
      <Text style={s.subhead}>Ideas</Text>
      {IDEAS.map((idea) => (
        <Button key={idea} title={idea} variant="ghost" size="sm" icon="bulb-outline" onPress={() => setEditing({ prompt: idea })} style={{ justifyContent: "flex-start", marginTop: 8 }} />
      ))}
      <TaskSheet task={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </ScrollView>
  );
}

function TaskSheet({ task, onClose, onSaved }) {
  const s = useStyles();
  const [prompt, setPrompt] = useState("");
  const [frequency, setFrequency] = useState("weekdays");
  const [hour, setHour] = useState(8);
  const [weekday, setWeekday] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isNew = !task?.id;

  useEffect(() => {
    if (!task) return;
    setPrompt(task.prompt ?? "");
    setFrequency(task.frequency ?? (/friday|monday|week/i.test(task.prompt ?? "") ? "weekly" : "weekdays"));
    setHour(task.hour_utc != null ? toLocal(task.hour_utc) : 8);
    setWeekday(task.weekday != null ? localDay(task) : /monday/i.test(task.prompt ?? "") ? 1 : 5);
    setError(null);
  }, [task]);

  async function save() {
    setBusy(true);
    setError(null);
    // Weekly tasks: shift the weekday when converting the hour crosses midnight
    const utcHour = toUtc(hour);
    const dayShift = hour - offsetHours() < 0 ? -1 : hour - offsetHours() >= 24 ? 1 : 0;
    const body = { prompt, frequency, hour_utc: utcHour, weekday: (weekday + dayShift + 7) % 7 };
    try {
      if (isNew) await api.createAutomation(body);
      else await api.updateAutomation(task.id, body);
      onSaved();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  async function remove() {
    await api.deleteAutomation(task.id).catch(() => {});
    onSaved();
  }

  return (
    <Sheet visible={!!task} onClose={onClose} eyebrow="Automation" title={isNew ? "New automation" : "Edit automation"}>
      <Text style={s.label}>What should the Copilot do?</Text>
      <Input value={prompt} onChangeText={setPrompt} placeholder="Check my watchlist for…" multiline inputStyle={{ minHeight: 80 }} />
      <Text style={[s.label, { marginTop: 16 }]}>How often</Text>
      <Segmented options={[["daily", "Every day"], ["weekdays", "Weekdays"], ["weekly", "Weekly"]]} value={frequency} onChange={setFrequency} />
      {frequency === "weekly" && (
        <View style={s.chips}>
          {DAYS.map((d, i) => <Chip key={d} label={d} active={weekday === i} onPress={() => setWeekday(i)} />)}
        </View>
      )}
      <Text style={[s.label, { marginTop: 16 }]}>Time (your time zone)</Text>
      <View style={s.chips}>
        {[6, 7, 8, 9, 12, 16, 17, 20].map((h) => <Chip key={h} label={hourLabel(h)} active={hour === h} onPress={() => setHour(h)} />)}
      </View>
      <Text style={[s.muted, { marginTop: 10 }]}>Each run uses one Copilot message from your daily plan. You'll get the answer as a notification.</Text>
      <ErrorNotice error={error} />
      <Button title="Save automation" icon="checkmark" onPress={save} loading={busy} disabled={prompt.trim().length < 8} size="lg" style={{ marginTop: 16 }} />
      {!isNew && <Button title="Delete" variant="danger" icon="trash-outline" onPress={remove} style={{ marginTop: 10 }} />}
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  card: { backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 16, marginTop: 12 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { color: c.text, fontWeight: "800", fontSize: 15 },
  muted: { color: c.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  result: { backgroundColor: c.surfaceAlt, borderRadius: 12, padding: 12, marginTop: 12 },
  resultLabel: { color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  resultText: { color: c.text, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  subhead: { color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 26 },
  label: { fontWeight: "700", color: c.text, marginBottom: 6, fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
}));
