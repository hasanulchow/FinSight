import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { useLivePrices } from "../lib/live";
import { makeStyles, useTheme } from "../theme";
import { Button, Chip, Input, Pill, TickerAvatar } from "./ui";
import { ErrorNotice } from "./Upgrade";
import Sheet from "./Sheet";

// Forecasts UI: question cards with market odds, crowd odds and your forecast, plus the "ask a question" sheet.
// Play money only: forecasts earn points for accuracy, never money or prizes.

export const PROBS = [5, 10, 25, 40, 50, 60, 75, 90, 95];
const pctText = (p) => (p == null ? "–" : `${Math.round(p * 100)}%`);
export const shortDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** One labeled probability bar. */
function OddsBar({ label, value, color, note }) {
  const s = useStyles();
  return (
    <View style={s.oddsRow}>
      <Text style={s.oddsLabel} numberOfLines={1}>{label}</Text>
      <View style={s.track}>{value != null && <View style={[s.fill, { width: `${Math.max(2, value * 100)}%`, backgroundColor: color }]} />}</View>
      <Text style={[s.oddsValue, { color: value != null ? color : undefined }]}>{value != null ? pctText(value) : note ?? "–"}</Text>
    </View>
  );
}

/** A forecast question: price context, market / crowd / your odds, and the forecast chips (or the result). */
export function QuestionCard({ q, onChanged, onOpenStock, showTicker = true }) {
  const { c } = useTheme();
  const s = useStyles();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const resolved = q.status === "resolved";
  const mine = q.mine?.prob;

  async function pick(p) {
    setBusy(p);
    setError(null);
    try {
      await api.forecast(q.id, p);
      await onChanged?.();
    } catch (e) {
      setError(e);
    }
    setBusy(null);
  }

  const dist = q.distance_pct;
  return (
    <View style={s.card}>
      <Pressable onPress={() => onOpenStock?.(q.ticker)} style={s.head} disabled={!onOpenStock}>
        {showTicker && <TickerAvatar ticker={q.ticker} size={36} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title}>Will {q.ticker} close above ${q.strike} on {shortDate(q.resolve_date)}?</Text>
          <Text style={s.muted}>
            {resolved
              ? `Closed at $${q.close_price}`
              : q.price != null
                ? `Now $${q.price.toFixed(2)} · ${dist > 0 ? `needs +${dist}%` : dist < 0 ? `${Math.abs(dist)}% above the line` : "right at the line"}`
                : "Price unavailable"}
            {q.source === "user" ? " · asked by a user" : ""}
          </Text>
        </View>
        {resolved ? (
          <Pill text={q.outcome ? "Yes" : "No"} color={q.outcome ? c.gain : c.loss} icon={q.outcome ? "checkmark" : "close"} />
        ) : q.locked ? (
          <Pill text="Closed" color={c.muted} icon="lock-closed-outline" />
        ) : null}
      </Pressable>

      <View style={{ marginTop: 10, gap: 6 }}>
        <OddsBar label={q.odds_source === "options" ? "Options market" : "Volatility model"} value={q.market_prob} color={c.primary} />
        <OddsBar label={`Crowd · ${q.forecasters}`} value={q.crowd_prob} color={c.hue("violet")} note={q.forecasters ? "Forecast to see" : "No forecasts yet"} />
        {mine != null && <OddsBar label="You" value={mine} color={c.hue("amber")} />}
      </View>

      {resolved && mine != null && (
        <Text style={[s.result, { color: q.mine.points >= 0 ? c.gain : c.loss }]}>
          {q.mine.points >= 0 ? "+" : ""}{q.mine.points} points
          {q.mine.market_prob != null && <Text style={s.muted}>{`  ·  ${(mine - (q.outcome ? 1 : 0)) ** 2 < (q.mine.market_prob - (q.outcome ? 1 : 0)) ** 2 ? "you beat the market" : "the market did better"}`}</Text>}
        </Text>
      )}

      {!resolved && !q.locked && (
        <>
          <Text style={s.prompt}>{mine != null ? "Change your forecast" : "Your chance it closes above"}</Text>
          <View style={s.chips}>
            {PROBS.map((p) => (
              <Chip key={p} label={busy === p ? "…" : `${p}%`} active={mine != null && Math.round(mine * 100) === p} onPress={() => pick(p)} color={p > 50 ? c.gain : p < 50 ? c.loss : undefined} />
            ))}
          </View>
        </>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}

/** The last weekday on or before a date. */
function weekdayOnOrBefore(d) {
  const x = new Date(`${d}T12:00:00Z`);
  while ([0, 6].includes(x.getUTCDay())) x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}

/** Date choices: this Friday (if 2+ days away), next Friday, end of this month, end of next month. */
export function dateChoices(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const day = now.getUTCDay();
  const toFri = (5 - day + 7) % 7;
  const add = (n) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const toNext = toFri >= 1 ? toFri : 7; // on a Friday, "this Friday" means next week's
  const endOf = (m) => weekdayOnOrBefore(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m + 1, 0)).toISOString().slice(0, 10));
  return [
    [add(toNext), "This Friday"],
    [add(toNext + 7), "Next Friday"],
    [endOf(0), "End of month"],
    [endOf(1), "End of next month"],
  ].filter(([d], i, all) => d > today && all.findIndex(([x]) => x === d) === i);
}

/** Sheet to ask a new question: ticker, price line, date. */
export function AskSheet({ visible, ticker: preset, onClose, onAsked }) {
  const { c } = useTheme();
  const s = useStyles();
  const [ticker, setTicker] = useState("");
  const [strike, setStrike] = useState("");
  const [date, setDate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const sym = ticker.trim().toUpperCase();
  const live = useLivePrices(visible && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym) ? [sym] : []);
  const price = live.prices[sym]?.p;
  const choices = dateChoices();

  useEffect(() => {
    if (!visible) return;
    setTicker(preset ?? "");
    setStrike("");
    setDate(choices[0]?.[0] ?? null);
    setError(null);
  }, [visible, preset]);

  const step = price < 50 ? 1 : price < 200 ? 5 : price < 1000 ? 10 : 50;
  const lines = price ? [...new Set([-0.1, -0.05, 0, 0.05, 0.1].map((m) => Math.round((price * (1 + m)) / step) * step))] : [];

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const q = await api.askForecast({ ticker: sym, strike: Number(strike), resolve_date: date });
      onAsked?.(q);
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  return (
    <Sheet visible={visible} onClose={onClose} eyebrow="Forecasts" title="Ask a question" maxWidth={520}>
      <Text style={s.label}>Stock</Text>
      <Input value={ticker} onChangeText={setTicker} placeholder="NVDA" autoCapitalize="characters" />
      {price != null && <Text style={s.hint}>{sym} is at ${price.toFixed(2)}</Text>}
      <Text style={s.label}>Will it close above…</Text>
      <Input value={strike} onChangeText={setStrike} placeholder={price ? String(Math.round(price / step) * step) : "Price"} keyboardType="decimal-pad" />
      {lines.length > 0 && <View style={[s.chips, { marginTop: 8 }]}>{lines.map((k) => <Chip key={k} label={`$${k}`} active={Number(strike) === k} onPress={() => setStrike(String(k))} />)}</View>}
      <Text style={s.label}>…at the close on</Text>
      <View style={s.chips}>{choices.map(([d, l]) => <Chip key={d} label={`${l} · ${shortDate(d)}`} active={date === d} onPress={() => setDate(d)} />)}</View>
      <Text style={s.hint}>Questions are shared with everyone and resolve on the official closing price. You can add 5 a day.</Text>
      <ErrorNotice error={error} />
      <Button title="Add question" icon="add" onPress={ask} loading={busy} disabled={!sym || !(Number(strike) > 0) || !date} style={{ marginTop: 14 }} />
    </Sheet>
  );
}

/** Stock page card: open forecast questions on this ticker. */
export function ForecastCard({ ticker }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [qs, setQs] = useState(null);
  const [asking, setAsking] = useState(false);
  const load = () => api.forecastQuestions({ ticker }).then(setQs).catch(() => setQs([]));
  useEffect(() => {
    load();
  }, [ticker]);
  if (!qs) return null;
  return (
    <View style={[s.panel, { marginTop: 14 }]}>
      <View style={s.head}>
        <View style={[s.icon, { backgroundColor: sections.forecasts.soft }]}><Ionicons name={sections.forecasts.icon} size={19} color={sections.forecasts.color} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.panelTitle}>Forecasts on {ticker}</Text>
          <Text style={s.muted}>Play money · scored on accuracy</Text>
        </View>
        <Button title="Ask" icon="add" size="sm" variant="secondary" onPress={() => setAsking(true)} />
      </View>
      {!qs.length && <Text style={[s.muted, { marginTop: 10 }]}>No open questions on {ticker} yet. Ask one, like "close above $X by Friday?"</Text>}
      {qs.slice(0, 3).map((q) => <QuestionCard key={q.id} q={q} onChanged={load} showTicker={false} />)}
      <AskSheet visible={asking} ticker={ticker} onClose={() => setAsking(false)} onAsked={() => { setAsking(false); load(); }} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  panel: { padding: 16, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  panelTitle: { color: c.text, fontSize: 16, fontWeight: "700" },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: c.text, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  muted: { color: c.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  oddsRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  oddsLabel: { color: c.textSecondary, fontSize: 12, width: 112 },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  oddsValue: { color: c.muted, fontSize: 12.5, fontWeight: "700", minWidth: 44, textAlign: "right", fontVariant: ["tabular-nums"] },
  prompt: { color: c.text, fontSize: 12.5, fontWeight: "700", marginTop: 12, marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  result: { fontSize: 14, fontWeight: "800", marginTop: 10 },
  label: { fontWeight: "700", color: c.text, fontSize: 13, marginTop: 16, marginBottom: 8 },
  hint: { color: c.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
}));
