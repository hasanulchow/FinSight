import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { formatMoney, makeStyles, useTheme, font } from "../theme";
import { Banner, Bullets, Disclaimer, Loading, PageHeader, SectionCard, Segmented, Stat, TickerAvatar } from "../components/ui";
import { ErrorNotice } from "../components/Upgrade";

const signed = (v) => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "-" : ""}${formatMoney(Math.abs(v))}`);

/** Tax center: realized gains (short vs long term), wash sales, and tax-loss harvesting candidates. */
export default function TaxScreen({ onOpenStock }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.tax(year));
      setError(null);
    } catch (e) {
      setError(e);
    }
    setLoading(false);
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  const r = data?.realized;
  const maxMonth = Math.max(1, ...(data?.by_month ?? []).map((m) => Math.abs(m.pnl)));

  return (
    <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={load} tintColor={c.primary} />}>
      <PageHeader eyebrow="Tax center" title={r ? signed(r.net) : "Taxes, simplified"} subtitle={r ? `Net realized P/L in ${data.year} from your journal` : "Realized gains, wash sales and harvesting ideas from your journal and holdings."} />
      <Segmented options={[[String(thisYear), String(thisYear)], [String(thisYear - 1), String(thisYear - 1)]]} value={year} onChange={setYear} />
      <ErrorNotice error={error} />
      {loading && !data && <Loading />}

      {data && (
        <>
          <View style={s.stats}>
            <Stat label="Short-term (≤ 1 year)" value={signed(r.short_term.net)} hint={`${r.short_term.trades} trades`} color={r.short_term.net >= 0 ? c.gain : c.loss} />
            <Stat label="Long-term (> 1 year)" value={signed(r.long_term.net)} hint={`${r.long_term.trades} trades`} color={r.long_term.net >= 0 ? c.gain : c.loss} />
          </View>
          <View style={[s.stats, { marginTop: 8 }]}>
            <Stat label="Harvestable losses" value={signed(data.harvestable_losses)} hint="unrealized, in holdings" color={c.loss} />
            <Stat label="Wash-sale losses" value={formatMoney(data.wash_disallowed_estimate)} hint={`${data.wash_sales.length} flagged`} color={data.wash_sales.length ? c.warn : undefined} />
          </View>

          {data.notes.length > 0 && (
            <SectionCard title="What this means" section={sections.coach}>
              <Bullets items={data.notes} />
            </SectionCard>
          )}

          <SectionCard title="Realized P/L by month" section={sections.journal}>
            {data.by_month.map((m) => (
              <View key={m.month} style={s.monthRow}>
                <Text style={s.month}>{new Date(2000, m.month - 1, 1).toLocaleString(undefined, { month: "short" })}</Text>
                <View style={s.track}>
                  {m.pnl !== 0 && <View style={[s.fill, { width: `${(Math.abs(m.pnl) / maxMonth) * 100}%`, backgroundColor: m.pnl >= 0 ? c.gain : c.loss }]} />}
                </View>
                <Text style={[s.monthPnl, { color: m.pnl > 0 ? c.gain : m.pnl < 0 ? c.loss : c.muted }]}>{m.pnl ? signed(m.pnl) : "–"}</Text>
              </View>
            ))}
          </SectionCard>

          <SectionCard title="Tax-loss harvesting ideas" subtitle="Holdings below what you paid" section={sections.redflags}>
            {!data.harvest_candidates.length && <Text style={s.muted}>No holdings are below cost basis (or cost basis isn't set).</Text>}
            {data.harvest_candidates.map((h) => (
              <View key={h.ticker} style={s.harvestRow}>
                <TickerAvatar ticker={h.ticker} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={s.ticker} onPress={() => onOpenStock?.(h.ticker)}>{h.ticker} <Text style={s.muted}>{h.shares} sh · cost ${h.cost_basis} → ${h.price}</Text></Text>
                  <Text style={s.muted}>If sold, don't rebuy before {h.rebuy_safe_after} to avoid a wash sale.</Text>
                  {h.recent_buy_warning && (
                    <View style={s.warnRow}>
                      <Ionicons name="warning" size={13} color={c.warn} />
                      <Text style={[s.muted, { color: c.warn, flex: 1 }]}>{h.recent_buy_warning}</Text>
                    </View>
                  )}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.ticker, { color: c.loss }]}>{signed(h.unrealized_loss)}</Text>
                  <Text style={s.muted}>{h.loss_pct}%</Text>
                </View>
              </View>
            ))}
          </SectionCard>

          {data.wash_sales.length > 0 && (
            <SectionCard title="Possible wash sales" section={sections.alerts}>
              {data.wash_sales.map((w, i) => (
                <Text key={i} style={s.wash}><Text style={{ fontWeight: "800", fontFamily: font("800") }}>{w.ticker}</Text>: sold {w.sold} at a {signed(w.loss)} loss, rebought {w.rebought}.</Text>
              ))}
            </SectionCard>
          )}
          <Banner tone="info" icon="document-text-outline">{data.disclaimer}</Banner>
        </>
      )}
      <Disclaimer>Educational estimates, not tax advice.</Disclaimer>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  stats: { flexDirection: "row", gap: 8, marginTop: 14 },
  muted: { color: c.muted, fontSize: 12, lineHeight: 17 },
  monthRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  month: { width: 34, color: c.textSecondary, fontSize: 12, fontWeight: "600" },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: c.surfaceAlt, overflow: "hidden" },
  fill: { height: 10, borderRadius: 5 },
  monthPnl: { width: 84, textAlign: "right", fontWeight: "700", fontSize: 13, fontVariant: ["tabular-nums"] },
  harvestRow: { flexDirection: "row", gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border, alignItems: "center" },
  ticker: { color: c.text, fontWeight: "800", fontSize: 15 },
  warnRow: { flexDirection: "row", gap: 6, marginTop: 4, alignItems: "flex-start" },
  wash: { color: c.text, fontSize: 14, lineHeight: 20, marginBottom: 6 },
}));
