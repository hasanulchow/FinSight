import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme, font } from "../theme";
import { Button, Disclaimer, EmptyState, Input, Loading, PageHeader, Pill, SectionCard, TickerAvatar } from "../components/ui";
import { ErrorNotice } from "../components/Upgrade";
import Sheet from "../components/Sheet";
import EarningsSheet from "../components/EarningsSheet";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

/** Today: the AI morning brief plus the watchlist with thesis tracking. */
export default function TodayScreen({ onOpenStock }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [brief, setBrief] = useState(null);
  const [watch, setWatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // {} for new, or a watchlist row
  const [checking, setChecking] = useState(null);
  const [earnings, setEarnings] = useState([]);
  const [earningsTicker, setEarningsTicker] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, w] = await Promise.all([api.brief(), api.watchlist()]);
      setBrief(b.empty ? null : b);
      setWatch(w);
      api.earningsUpcoming(14).then(setEarnings).catch(() => {});
      setError(null);
    } catch (e) {
      setError(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const b = await api.generateBrief();
      setBrief(b.empty ? null : b);
    } catch (e) {
      setError(e);
    }
    setGenerating(false);
  }

  async function check(item) {
    setChecking(item.id);
    setError(null);
    try {
      const row = await api.checkThesis(item.id);
      setWatch((w) => w.map((x) => (x.id === row.id ? row : x)));
    } catch (e) {
      setError(e);
    }
    setChecking(null);
  }

  const today = new Date().toISOString().slice(0, 10);
  const content = brief?.content;
  const stale = brief && brief.date !== today;
  const IMPORTANCE = { high: c.loss, medium: c.warn, low: c.muted };
  const STATUS = { intact: [c.gain, "Intact", "checkmark-circle"], watch: [c.info, "Watch", "eye"], weakening: [c.warn, "Weakening", "trending-down"], broken: [c.loss, "Broken", "close-circle"], unchecked: [c.muted, "Not checked", "help-circle"] };

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={loading && !!watch} onRefresh={load} tintColor={c.primary} />}>
      <PageHeader eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} title={greeting()} subtitle="What changed for the stocks you own and watch." />
      <ErrorNotice error={error} />
      {loading && !watch && <Loading text="Loading your day…" />}

      {watch && (
        <SectionCard
          title="Morning brief"
          subtitle={brief ? `${stale ? "From " + brief.date : "Today"} · AI summary of your stocks` : "AI summary of what changed overnight"}
          section={sections.copilot}
          right={<Button title={brief ? "Refresh" : "Write it"} icon="sparkles" size="sm" variant={brief ? "secondary" : "primary"} onPress={generate} loading={generating} disabled={!watch.length && !brief} />}
        >
          {generating && <Loading text="Checking prices, filings, earnings and insiders…" />}
          {!generating && !content && <Text style={s.muted}>{watch.length ? "Your brief arrives every weekday before the open. Tap Write it to get today's now." : "Add stocks to your watchlist (or holdings) and FinSight will brief you every morning."}</Text>}
          {!generating && content && (
            <View>
              <Text style={s.headline}>{content.headline}</Text>
              {content.market_note ? <Text style={s.note}>{content.market_note}</Text> : null}
              {content.items?.map((it, i) => (
                <Pressable key={i} onPress={() => onOpenStock(it.ticker)} style={({ hovered }) => [s.item, hovered && { backgroundColor: c.surfaceAlt }]}>
                  <View style={[s.bar, { backgroundColor: IMPORTANCE[it.importance] ?? c.muted }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.itemTicker}>{it.ticker}</Text>
                    <Text style={s.itemText}>{it.what_changed}</Text>
                    <Text style={s.itemWhy}>{it.why_it_matters}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.muted} />
                </Pressable>
              ))}
              {content.calendar?.length > 0 && (
                <View style={s.calendar}>
                  <Text style={s.subhead}>This week</Text>
                  {content.calendar.map((e, i) => (
                    <View key={i} style={s.calRow}>
                      <Ionicons name="calendar-outline" size={14} color={sections.events.color} />
                      <Text style={s.calText}>{e}</Text>
                    </View>
                  ))}
                </View>
              )}
              {content.quiet?.length > 0 && <Text style={[s.muted, { marginTop: 10 }]}>Quiet: {content.quiet.join(", ")}</Text>}
            </View>
          )}
        </SectionCard>
      )}

      {earnings.length > 0 && (
        <SectionCard title="Earnings coming up" subtitle="Your holdings and watchlist, next 2 weeks" section={sections.events}>
          {earnings.map((e) => (
            <Pressable key={`${e.ticker}-${e.date}`} onPress={() => setEarningsTicker(e.ticker)} style={({ hovered }) => [s.earnRow, hovered && { backgroundColor: c.surfaceAlt }]}>
              <TickerAvatar ticker={e.ticker} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={s.watchTicker}>{e.ticker}{e.owned ? <Text style={s.muted}>  you own it</Text> : null}</Text>
                <Text style={s.muted}>{new Date(`${e.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {e.hour === "amc" ? "after close" : e.hour === "bmo" ? "before open" : "time TBA"}</Text>
              </View>
              <Text style={[s.muted, { color: c.primary, fontWeight: "700", fontFamily: font("700") }]}>Preview</Text>
            </Pressable>
          ))}
        </SectionCard>
      )}

      {watch && (
        <SectionCard
          title="Watchlist & theses"
          subtitle="Write why you own it. The AI checks if that's still true."
          section={sections.portfolio}
          right={<Button title="Add" icon="add" size="sm" onPress={() => setEditing({})} />}
        >
          {!watch.length && <EmptyState icon="eye-outline" title="Nothing on your watchlist" text="Add a stock and a one-line thesis, like “NVDA: data-center AI demand keeps growing.”" action={<Button title="Add a stock" icon="add" onPress={() => setEditing({})} />} />}
          {watch.map((w) => {
            const [color, label, icon] = STATUS[w.status ?? (w.thesis ? "unchecked" : "")] ?? [c.muted, "", null];
            return (
              <View key={w.id} style={s.watchRow}>
                <Pressable onPress={() => onOpenStock(w.ticker)}>
                  <TickerAvatar ticker={w.ticker} size={40} />
                </Pressable>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={s.watchHead}>
                    <Text style={s.watchTicker}>{w.ticker}</Text>
                    {w.thesis && label ? <Pill text={label} color={color} icon={icon} /> : null}
                  </View>
                  {w.thesis ? <Text style={s.thesis} numberOfLines={2}>“{w.thesis}”</Text> : <Text style={s.muted}>No thesis yet</Text>}
                  {w.last_check?.summary && <Text style={s.verdict}>{w.last_check.summary}</Text>}
                  {w.last_check?.what_to_watch?.length > 0 && <Text style={s.muted}>Watch: {w.last_check.what_to_watch.join(" · ")}</Text>}
                  <View style={s.watchActions}>
                    {w.thesis ? (
                      <Button title={w.last_check ? "Re-check" : "Check thesis"} icon="shield-checkmark-outline" size="sm" variant="secondary" onPress={() => check(w)} loading={checking === w.id} />
                    ) : null}
                    <Button title={w.thesis ? "Edit" : "Add thesis"} icon="create-outline" size="sm" variant="ghost" onPress={() => setEditing(w)} />
                  </View>
                </View>
              </View>
            );
          })}
        </SectionCard>
      )}

      <Disclaimer>Briefs and thesis checks are AI summaries of public data. They can be wrong and are not investment advice.</Disclaimer>
      <EarningsSheet ticker={earningsTicker} visible={!!earningsTicker} onClose={() => setEarningsTicker(null)} />
      <WatchSheet item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
    </ScrollView>
  );
}

function WatchSheet({ item, onClose, onSaved }) {
  const s = useStyles();
  const [ticker, setTicker] = useState("");
  const [thesis, setThesis] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isNew = !item?.id;

  useEffect(() => {
    setTicker(item?.ticker ?? "");
    setThesis(item?.thesis ?? "");
    setError(null);
  }, [item]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (isNew) await api.addWatch(ticker.trim().toUpperCase(), thesis.trim() || undefined);
      else await api.updateWatch(item.id, thesis.trim() || null);
      onSaved();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  async function remove() {
    await api.deleteWatch(item.id).catch(() => {});
    onSaved();
  }

  return (
    <Sheet visible={!!item} onClose={onClose} eyebrow={isNew ? "Watchlist" : item?.ticker} title={isNew ? "Watch a stock" : "Your thesis"}>
      {isNew && (
        <>
          <Text style={s.label}>Ticker</Text>
          <Input value={ticker} onChangeText={setTicker} placeholder="NVDA" autoCapitalize="characters" />
        </>
      )}
      <Text style={[s.label, { marginTop: 14 }]}>Why do you own or watch it? (optional)</Text>
      <Input value={thesis} onChangeText={setThesis} placeholder="e.g. AI data-center demand keeps revenue growing 30%+ with high margins" multiline inputStyle={{ minHeight: 70 }} />
      <Text style={[s.muted, { marginTop: 8 }]}>Be specific: the AI checks earnings, filings, insider trades and price action against what you write.</Text>
      <ErrorNotice error={error} />
      <Button title="Save" icon="checkmark" onPress={save} loading={busy} disabled={isNew && !ticker.trim()} size="lg" style={{ marginTop: 16 }} />
      {!isNew && <Button title="Remove from watchlist" variant="danger" icon="trash-outline" onPress={remove} style={{ marginTop: 10 }} />}
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  muted: { color: c.muted, fontSize: 13, lineHeight: 19 },
  headline: { color: c.text, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  note: { color: c.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 6 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingRight: 6, borderTopWidth: 1, borderTopColor: c.border, marginTop: 10, borderRadius: 8 },
  bar: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  itemTicker: { color: c.text, fontWeight: "800", fontSize: 14 },
  itemText: { color: c.text, fontSize: 14, lineHeight: 20, marginTop: 2 },
  itemWhy: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 3 },
  calendar: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: c.surfaceAlt },
  subhead: { color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  calRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  calText: { flex: 1, color: c.text, fontSize: 13 },
  earnRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border, borderRadius: 8 },
  watchRow: { flexDirection: "row", gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.border },
  watchHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  watchTicker: { color: c.text, fontWeight: "800", fontSize: 16 },
  thesis: { color: c.textSecondary, fontSize: 14, fontStyle: "italic", lineHeight: 20, marginTop: 4 },
  verdict: { color: c.text, fontSize: 13, lineHeight: 19, marginTop: 6 },
  watchActions: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  label: { fontWeight: "700", color: c.text, marginBottom: 6, fontSize: 13 },
}));
