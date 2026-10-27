import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Bullets, Button, Loading, Logo, Stat, TickerAvatar } from "../components/ui";

/** Public page for a share link (no sign-in): a briefing summary or a journal stats card, plus a sign-up CTA. */
export default function ShareScreen({ token, onSignUp }) {
  const { c } = useTheme();
  const s = useStyles();
  const [share, setShare] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.publicShare(token).then(setShare).catch((e) => setError(e.message));
  }, [token]);

  const p = share?.payload;
  const cta = () => onSignUp(p?.ref);

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <View style={s.top}>
        <Logo size={32} />
        <Button title="Try FinSight free" size="sm" onPress={cta} />
      </View>
      {!share && !error && <Loading />}
      {error && <Text style={s.muted}>{error}</Text>}

      {share?.kind === "briefing" && (
        <View style={s.card}>
          <View style={s.head}>
            <TickerAvatar ticker={p.ticker} size={52} />
            <View style={{ flex: 1 }}>
              <Text style={s.eyebrow}>AI stock briefing</Text>
              <Text style={s.title}>{p.company ?? p.ticker}</Text>
              <Text style={s.muted}>{p.ticker} · {new Date(p.created_at).toLocaleDateString()}</Text>
            </View>
          </View>
          {p.summary && <Text style={s.body}>{p.summary}</Text>}
          {p.takeaways?.length > 0 && (
            <>
              <Text style={s.subhead}>Key takeaways</Text>
              <Bullets items={p.takeaways} />
            </>
          )}
          {p.risks?.length > 0 && (
            <>
              <Text style={s.subhead}>Top risks from the 10-K</Text>
              <Bullets items={p.risks} color={c.loss} />
            </>
          )}
        </View>
      )}

      {share?.kind === "journal" && (
        <LinearGradient colors={c.brand.slice(0, 2)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.journal}>
          <Text style={s.jEyebrow}>My trading, measured by FinSight</Text>
          <Text style={s.jTitle}>{p.win_rate}% win rate</Text>
          <Text style={s.jSub}>across {p.closed} closed trades</Text>
          {p.curve?.length > 1 && (
            <Svg width="100%" height={80} viewBox="0 0 100 100" preserveAspectRatio="none" style={{ marginTop: 16 }}>
              <Polyline points={p.curve.map((v, i) => `${(i / (p.curve.length - 1)) * 100},${100 - v}`).join(" ")} fill="none" stroke="#FFFFFF" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
            </Svg>
          )}
          <View style={s.jStats}>
            <Stat label="Profit factor" value={p.profit_factor ?? "–"} style={s.jStat} color="#1E1B4B" />
            <Stat label="Avg R" value={p.avg_r != null ? `${p.avg_r}R` : "–"} style={s.jStat} color="#1E1B4B" />
            <Stat label="Used a stop" value={p.trades_with_stop_pct != null ? `${p.trades_with_stop_pct}%` : "–"} style={s.jStat} color="#1E1B4B" />
          </View>
          {p.best_setup && <Text style={s.jNote}>Best setup: {p.best_setup}{p.calm_win_rate != null ? ` · ${p.calm_win_rate}% win rate when calm` : ""}</Text>}
        </LinearGradient>
      )}

      {share && (
        <View style={s.ctaCard}>
          <Text style={s.ctaTitle}>Research smarter, trade calmer</Text>
          <Text style={s.body}>AI briefings from SEC filings, a Copilot that checks your stocks every morning, and a journal that coaches your habits.</Text>
          <Button title={p?.ref ? "Join and get 14 days of Pro free" : "Create your free account"} icon="rocket" size="lg" onPress={cta} style={{ marginTop: 14 }} />
          <Text style={[s.muted, { marginTop: 10, textAlign: "center" }]}>Educational research, not investment advice.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 20, paddingBottom: 60, maxWidth: 640, width: "100%", alignSelf: "center" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
  card: { backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 20 },
  head: { flexDirection: "row", gap: 14, alignItems: "center", marginBottom: 14 },
  eyebrow: { color: c.primary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  title: { color: c.text, fontSize: 22, fontWeight: "800" },
  subhead: { color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  body: { color: c.textSecondary, fontSize: 15, lineHeight: 23 },
  muted: { color: c.muted, fontSize: 13 },
  journal: { borderRadius: 24, padding: 24 },
  jEyebrow: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  jTitle: { color: "#FFFFFF", fontSize: 40, fontWeight: "800", letterSpacing: -1, marginTop: 8 },
  jSub: { color: "rgba(255,255,255,0.85)", fontSize: 15 },
  jStats: { flexDirection: "row", gap: 8, marginTop: 16 },
  jStat: { backgroundColor: "rgba(255,255,255,0.92)" },
  jNote: { color: "#FFFFFF", fontSize: 13, marginTop: 14, fontWeight: "600" },
  ctaCard: { backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 20, marginTop: 18 },
  ctaTitle: { color: c.text, fontSize: 20, fontWeight: "800", marginBottom: 6 },
}));
