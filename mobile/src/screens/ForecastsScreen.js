import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Banner, Button, EmptyState, Input, Loading, PageHeader, SectionCard, Segmented, Stat } from "../components/ui";
import { ErrorNotice } from "../components/Upgrade";
import { AskSheet, QuestionCard, shortDate } from "../components/Forecasts";

// Forecasts tab: a play-money prediction game on where stocks close. Open questions, results, the
// leaderboard and your calibration. Points only, never money or prizes.

export default function ForecastsScreen({ onOpenStock }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [view, setView] = useState("open");
  const [qs, setQs] = useState(null);
  const [stats, setStats] = useState(null);
  const [board, setBoard] = useState(null);
  const [period, setPeriod] = useState("30d");
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [asking, setAsking] = useState(false);

  const loadQuestions = useCallback(async () => {
    try {
      setQs(await api.forecastQuestions({ status: view === "resolved" ? "resolved" : "open" }));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [view]);
  const loadStats = useCallback(() => api.forecastStats().then(setStats).catch(() => {}), []);

  useEffect(() => {
    if (view === "open" || view === "resolved") {
      setQs(null);
      loadQuestions();
    }
  }, [view, loadQuestions]);
  useEffect(() => {
    loadStats();
  }, [loadStats]);
  useEffect(() => {
    if (view === "leaderboard") api.forecastLeaderboard(period).then(setBoard).catch(setError);
  }, [view, period]);

  async function refresh() {
    setRefreshing(true);
    await Promise.all([loadQuestions(), loadStats()]);
    setRefreshing(false);
  }

  // Group questions by resolution date
  const groups = [];
  for (const q of qs ?? []) {
    const g = groups.find((x) => x.date === q.resolve_date);
    g ? g.items.push(q) : groups.push({ date: q.resolve_date, items: [q] });
  }
  const m = stats?.last_30d;

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />}>
      <PageHeader eyebrow="Forecasts" title="Where will stocks close?" subtitle="Give your odds, see how you stack up against the options market and the crowd. Play money: points for accuracy, never real money." right={<Button title="Ask" icon="add" size="sm" onPress={() => setAsking(true)} />} />

      {stats && (
        <View style={s.stats}>
          <Stat label="Points · 30 days" value={`${m.points > 0 ? "+" : ""}${m.points}`} color={m.points >= 0 ? c.gain : c.loss} hint={`${m.resolved} resolved · ${stats.open} open`} />
          <Stat label="Beat the market" value={m.beat_market_pct != null ? `${m.beat_market_pct}%` : "–"} hint="of your calls vs options odds" />
          <Stat label="Accuracy" value={m.accuracy != null ? `${m.accuracy}%` : "–"} hint="right side of 50%" />
          <Stat label="Brier score" value={m.brier ?? "–"} hint={m.market_brier != null ? `market ${m.market_brier} · lower is better` : "lower is better"} />
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        <Segmented options={[["open", "Open"], ["resolved", "Results"], ["leaderboard", "Leaderboard"], ["you", "You"]]} value={view} onChange={setView} />
      </View>
      <ErrorNotice error={error} />

      {(view === "open" || view === "resolved") && (
        <>
          {!qs && !error && <Loading text="Loading questions…" />}
          {qs && !qs.length && (
            <EmptyState
              icon={sections.forecasts.icon}
              title={view === "open" ? "No open questions" : "No results yet"}
              text={view === "open" ? "This week's questions appear once prices load. Ask your own about any stock." : "Questions resolve after the close on their date. Your points show up here."}
              action={view === "open" ? <Button title="Ask a question" icon="add" onPress={() => setAsking(true)} /> : null}
            />
          )}
          {groups.map((g) => (
            <View key={g.date} style={{ marginTop: 18 }}>
              <Text style={s.group}>{view === "open" ? `Closes ${shortDate(g.date)}` : shortDate(g.date)} · {g.items.length} question{g.items.length > 1 ? "s" : ""}</Text>
              {g.items.map((q) => <QuestionCard key={q.id} q={q} onOpenStock={onOpenStock} onChanged={async () => { await loadQuestions(); loadStats(); }} />)}
            </View>
          ))}
        </>
      )}

      {view === "leaderboard" && (
        <SectionCard title="Leaderboard" subtitle={`Ranked by points · at least ${board?.min_forecasts ?? 5} resolved forecasts`} section={sections.forecasts} right={<Segmented options={[["30d", "30 days"], ["all", "All time"]]} value={period} onChange={setPeriod} />}>
          {!board && <Loading />}
          {board && !board.rows.length && <Text style={s.muted}>No one has enough resolved forecasts yet. Make your calls: the board fills as questions resolve each Friday.</Text>}
          {board?.rows.map((r) => (
            <View key={r.rank} style={[s.boardRow, r.you && { backgroundColor: c.soft(c.primary) }]}>
              <Text style={s.rank}>{r.rank}</Text>
              <Text style={[s.name, r.you && { color: c.primary }]} numberOfLines={1}>{r.name}{r.you ? " (you)" : ""}</Text>
              <Text style={s.muted}>{r.resolved} · Brier {r.brier}</Text>
              <Text style={[s.pts, { color: r.points >= 0 ? c.gain : c.loss }]}>{r.points > 0 ? "+" : ""}{r.points}</Text>
            </View>
          ))}
          {board && !board.you && <Text style={[s.muted, { marginTop: 10 }]}>You'll appear here after {board.min_forecasts} resolved forecasts.</Text>}
        </SectionCard>
      )}

      {view === "you" && stats && <YouPanel stats={stats} onSaved={loadStats} />}

      <Banner tone="info" icon="information-circle-outline">
        Scoring: points = 100 − 400 × (forecast − outcome)². Saying 50% scores 0; 90% scores +96 if right and −224 if wrong, so only be confident when you are. Market odds come from options prices (or recent volatility when a stock has none). Forecasts close at the open on the resolution day.
      </Banner>
      <Text style={s.disclaimer}>A game for learning to think in probabilities. No real money, prizes or payouts. Not investment advice.</Text>
      <AskSheet visible={asking} onClose={() => setAsking(false)} onAsked={() => { setAsking(false); setView("open"); loadQuestions(); }} />
    </ScrollView>
  );
}

/** Your calibration (did 70% calls happen about 70% of the time?) and leaderboard name. */
function YouPanel({ stats, onSaved }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [name, setName] = useState(stats.nickname ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const a = stats.all_time;
  const filled = stats.calibration.filter((b) => b.n > 0);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.setForecastName(name);
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  return (
    <>
      <SectionCard title="Calibration" subtitle="When you say 70%, does it happen about 70% of the time?" section={sections.forecasts}>
        {!filled.length ? (
          <Text style={s.muted}>Your calibration chart fills in as your forecasts resolve.</Text>
        ) : (
          <>
            {filled.map((b) => (
              <View key={b.from} style={s.calRow}>
                <Text style={s.calLabel}>{b.from}–{b.to}%</Text>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={s.track}><View style={[s.fill, { width: `${b.avg_forecast}%`, backgroundColor: c.hue("amber") }]} /></View>
                  <View style={s.track}><View style={[s.fill, { width: `${Math.max(1, b.happened)}%`, backgroundColor: c.gain }]} /></View>
                </View>
                <Text style={s.calN}>{b.happened}% · {b.n}</Text>
              </View>
            ))}
            <Text style={s.muted}>Amber: your average forecast in each band. Green: how often it happened. Close bars mean well calibrated.</Text>
          </>
        )}
        <View style={[s.stats, { marginTop: 12 }]}>
          <Stat label="All-time points" value={`${a.points > 0 ? "+" : ""}${a.points}`} color={a.points >= 0 ? c.gain : c.loss} hint={`${a.resolved} resolved`} />
          <Stat label="Your Brier" value={a.brier ?? "–"} hint={a.market_brier != null ? `options market ${a.market_brier}` : "lower is better"} />
        </View>
      </SectionCard>
      <SectionCard title="Leaderboard name" subtitle={`Shown as "${stats.name}"`} section={sections.account}>
        <Input value={name} onChangeText={(v) => { setName(v); setSaved(false); }} placeholder="Pick a name" maxLength={20} />
        <ErrorNotice error={error} />
        <Button title={saved ? "Saved" : "Save name"} icon={saved ? "checkmark" : undefined} variant="secondary" onPress={save} loading={busy} style={{ marginTop: 10, alignSelf: "flex-start" }} />
      </SectionCard>
    </>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  group: { color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  muted: { color: c.muted, fontSize: 12, lineHeight: 17 },
  boardRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 10 },
  rank: { color: c.muted, fontWeight: "800", width: 24, fontVariant: ["tabular-nums"] },
  name: { color: c.text, fontWeight: "700", flex: 1 },
  pts: { fontWeight: "800", minWidth: 52, textAlign: "right", fontVariant: ["tabular-nums"] },
  calRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  calLabel: { color: c.textSecondary, fontSize: 12, width: 62 },
  calN: { color: c.muted, fontSize: 11.5, width: 72, textAlign: "right" },
  track: { height: 7, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: "hidden" },
  fill: { height: 7, borderRadius: 4 },
  disclaimer: { color: c.muted, fontSize: 11.5, textAlign: "center", marginTop: 16 },
}));
