import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Bullets, Loading, Stat } from "./ui";
import { ErrorNotice } from "./Upgrade";
import Sheet from "./Sheet";

/** Earnings companion: implied move vs history, estimates, what to watch. */
export default function EarningsSheet({ ticker, visible, onClose }) {
  const { c } = useTheme();
  const s = useStyles();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible || !ticker) return;
    setData(null);
    setError(null);
    api.earningsPreview(ticker).then(setData).catch(setError);
  }, [visible, ticker]);

  const n = data?.next;
  const maxMove = Math.max(1, ...(data?.past_moves ?? []).map((m) => Math.abs(m.move_pct)), data?.implied_move?.pct ?? 0);

  return (
    <Sheet visible={visible} onClose={onClose} eyebrow="Earnings companion" title={`${ticker} earnings`}>
      <ErrorNotice error={error} />
      {!data && !error && <Loading text="Pricing the options and checking past reports…" />}
      {data && !n && <Text style={s.muted}>{data.message}</Text>}
      {n && (
        <View>
          <Text style={s.headline}>{data.headline}</Text>
          <View style={s.stats}>
            <Stat label="Reports" value={new Date(`${n.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} hint={n.timing} />
            <Stat label="Options imply" value={data.implied_move?.pct != null ? `±${data.implied_move.pct}%` : "–"} hint={data.implied_move ? `$${data.implied_move.low}–$${data.implied_move.high}` : null} />
            <Stat label="Avg past move" value={data.avg_abs_move_pct != null ? `±${data.avg_abs_move_pct}%` : "–"} hint={`last ${data.past_moves.length} reports`} />
          </View>
          {(n.eps_estimate != null || n.revenue_estimate != null) && (
            <Text style={s.estimates}>
              Analysts expect {n.eps_estimate != null ? `EPS of $${n.eps_estimate}` : ""}{n.eps_estimate != null && n.revenue_estimate ? " and " : ""}{n.revenue_estimate ? `revenue of $${(n.revenue_estimate / 1e9).toFixed(2)}B` : ""}.
            </Text>
          )}
          {data.past_moves?.length > 0 && (
            <View style={s.moves}>
              <Text style={s.subhead}>Past post-earnings moves</Text>
              {data.past_moves.map((m) => (
                <View key={m.date} style={s.moveRow}>
                  <Text style={s.moveDate}>{m.date.slice(0, 7)}</Text>
                  <View style={s.track}>
                    <View style={[s.fill, { width: `${(Math.abs(m.move_pct) / maxMove) * 100}%`, backgroundColor: m.move_pct >= 0 ? c.gain : c.loss }]} />
                  </View>
                  <Text style={[s.moveValue, { color: m.move_pct >= 0 ? c.gain : c.loss }]}>{m.move_pct > 0 ? "+" : ""}{m.move_pct}%</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={s.subhead}>Going in</Text>
          <Text style={s.body}>{data.setup}</Text>
          <Text style={s.subhead}>What to watch</Text>
          <Bullets items={data.what_to_watch ?? []} />
          <Text style={[s.muted, { marginTop: 8 }]}>{data.risk_note}</Text>
        </View>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  headline: { color: c.text, fontSize: 16, fontWeight: "700", lineHeight: 23 },
  stats: { flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" },
  estimates: { color: c.text, fontSize: 14, marginTop: 12 },
  moves: { marginTop: 14 },
  subhead: { color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  moveRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  moveDate: { width: 60, color: c.textSecondary, fontSize: 12 },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  moveValue: { width: 62, textAlign: "right", fontWeight: "700", fontSize: 12, fontVariant: ["tabular-nums"] },
  body: { color: c.text, fontSize: 14, lineHeight: 21 },
  muted: { color: c.muted, fontSize: 12, lineHeight: 17 },
}));
