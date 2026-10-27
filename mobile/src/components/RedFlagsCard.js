import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Loading, Pill, SectionCard } from "./ui";

/** Red-flag radar: dilution, offerings, going concern, listing notices, auditor changes, penny-stock risk. Loads on its own. */
export default function RedFlagsCard({ ticker }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.redFlags(ticker).then(setData).catch((e) => setError(e.message));
  }, [ticker]);

  const LEVEL = { none: [c.gain, "No red flags"], low: [c.info, "Low risk"], elevated: [c.warn, "Elevated risk"], high: [c.loss, "High risk"] };
  const SEV = { high: c.loss, medium: c.warn, low: c.info };
  const [color, label] = LEVEL[data?.risk_level] ?? [c.muted, ""];

  return (
    <SectionCard title="Red-flag radar" subtitle="Dilution, filings and penny-stock checks" section={sections.redflags} right={data && <Pill text={label} color={color} icon={data.risk_level === "none" ? "shield-checkmark" : "flag"} />}>
      {!data && !error && <Loading text="Scanning SEC filings…" />}
      {error && <Text style={s.muted}>Couldn't run the scan: {error}</Text>}
      {data && !data.flags.length && (
        <View style={s.clean}>
          <Ionicons name="shield-checkmark" size={18} color={c.gain} />
          <Text style={s.cleanText}>Nothing found across {data.checks_run.length} checks: {data.checks_run.join(", ")}.</Text>
        </View>
      )}
      {data?.flags.map((f) => (
        <View key={f.id} style={[s.flag, { borderLeftColor: SEV[f.severity] ?? c.muted }]}>
          <View style={s.flagHead}>
            <Text style={s.flagTitle}>{f.title}</Text>
            <Text style={[s.sev, { color: SEV[f.severity] }]}>{f.severity}</Text>
          </View>
          <Text style={s.flagText}>{f.evidence}</Text>
        </View>
      ))}
      {data && <Text style={[s.muted, { marginTop: 10 }]}>{data.note}</Text>}
    </SectionCard>
  );
}

const useStyles = makeStyles((c) => ({
  muted: { color: c.muted, fontSize: 12, lineHeight: 17 },
  clean: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: c.gainSoft, borderRadius: 12, padding: 12 },
  cleanText: { flex: 1, color: c.text, fontSize: 13, lineHeight: 19 },
  flag: { borderLeftWidth: 3, backgroundColor: c.surfaceAlt, borderRadius: 10, padding: 12, marginBottom: 8 },
  flagHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  flagTitle: { flex: 1, color: c.text, fontWeight: "800", fontSize: 14 },
  sev: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  flagText: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
}));
