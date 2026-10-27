import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { makeStyles, useTheme } from "../theme";
import { api } from "../lib/api";
import { Loading, Pill, SectionCard, Segmented, Stat } from "./ui";
import LineChart from "./LineChart";

const RANGES = [["63", "3M"], ["126", "6M"], ["252", "1Y"], ["500", "2Y"]];

/** Portfolio vs SPY: return, volatility, drawdown, Sharpe, beta. Uses current holdings held over the period. */
export default function BenchmarkCard({ refreshKey }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const sec = sections.benchmark;
  const [days, setDays] = useState("252");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api.benchmark(Number(days)).then(setData).catch((e) => setError(e.message));
  }, [days, refreshKey]);

  if (data?.empty) return null;
  const beat = (data?.excess_return_pct ?? 0) >= 0;
  const p = data?.portfolio, b = data?.benchmark_stats;

  return (
    <SectionCard title="vs S&P 500" subtitle="Are you beating just buying SPY?" section={sec} right={data && <Pill text={`${beat ? "+" : ""}${data.excess_return_pct}% vs SPY`} color={beat ? c.gain : c.loss} icon={beat ? "trending-up" : "trending-down"} />}>
      <Segmented options={RANGES} value={days} onChange={setDays} />
      {!data && !error && <Loading text="Comparing with SPY…" />}
      {error && <Text style={[s.muted, { marginTop: 12 }]}>Couldn't compare: {error}</Text>}
      {data && (
        <>
          <View style={{ marginTop: 14 }}>
            <LineChart
              data={data.points.map((pt) => ({ ...pt, x: pt.date }))}
              series={[{ key: "portfolio", label: "You", color: sec.color, fill: true }, { key: "benchmark", label: "SPY", color: c.muted, dashed: true }]}
              format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
              zero
              xLabel={(d) => new Date(`${d}T12:00:00Z`).toLocaleDateString()}
              height={170}
            />
          </View>
          <View style={s.table}>
            <View style={s.tr}>
              <Text style={[s.th, { flex: 1.3 }]} />
              <Text style={s.th}>You</Text>
              <Text style={s.th}>SPY</Text>
            </View>
            {[
              ["Return", `${p.total_return_pct}%`, `${b.total_return_pct}%`, p.total_return_pct >= b.total_return_pct],
              ["Volatility", `${p.volatility_pct}%`, `${b.volatility_pct}%`, p.volatility_pct <= b.volatility_pct],
              ["Max drawdown", `${p.max_drawdown_pct}%`, `${b.max_drawdown_pct}%`, p.max_drawdown_pct >= b.max_drawdown_pct],
              ["Sharpe", p.sharpe ?? "–", b.sharpe ?? "–", (p.sharpe ?? 0) >= (b.sharpe ?? 0)],
            ].map(([label, you, spy, better]) => (
              <View key={label} style={s.tr}>
                <Text style={[s.td, { flex: 1.3, color: c.textSecondary, textAlign: "left" }]}>{label}</Text>
                <Text style={[s.td, { color: better ? c.gain : c.loss, fontWeight: "800" }]}>{you}</Text>
                <Text style={s.td}>{spy}</Text>
              </View>
            ))}
          </View>
          <View style={s.stats}>
            <Stat label="Beta" value={data.beta ?? "–"} hint={data.beta > 1.1 ? "Swings more than SPY" : data.beta < 0.9 ? "Swings less than SPY" : "Moves like SPY"} />
            <Stat label="Correlation" value={data.correlation ?? "–"} hint="to SPY" />
          </View>
          <Text style={[s.muted, { marginTop: 10 }]}>
            {data.note}
            {data.tickers_missing?.length ? ` Not included (no price history): ${data.tickers_missing.join(", ")}.` : ""}
          </Text>
        </>
      )}
    </SectionCard>
  );
}

const useStyles = makeStyles((c) => ({
  muted: { color: c.muted, fontSize: 12, lineHeight: 17 },
  table: { marginTop: 14, borderRadius: 12, backgroundColor: c.surfaceAlt, padding: 10 },
  tr: { flexDirection: "row", paddingVertical: 5 },
  th: { flex: 1, color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", textAlign: "right" },
  td: { flex: 1, color: c.text, fontSize: 14, textAlign: "right", fontVariant: ["tabular-nums"] },
  stats: { flexDirection: "row", gap: 8, marginTop: 10 },
}));
