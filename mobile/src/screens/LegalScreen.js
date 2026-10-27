import { ScrollView, Text, View } from "react-native";
import { makeStyles } from "../theme";
import { BackButton, Segmented } from "../components/ui";
import { LEGAL, LEGAL_UPDATED } from "../lib/legal";

/** Terms, Privacy and Risk Disclaimer, switchable with tabs. */
export default function LegalScreen({ doc = "terms", onBack, onChange }) {
  const s = useStyles();
  const d = LEGAL[doc] ?? LEGAL.terms;
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      {onBack && <BackButton onPress={onBack} />}
      <View style={{ marginTop: 8 }}>
        <Segmented options={[["terms", "Terms"], ["privacy", "Privacy"], ["disclaimer", "Risk disclaimer"]]} value={doc} onChange={onChange} />
      </View>
      <Text style={s.title}>{d.title}</Text>
      <Text style={s.updated}>Last updated {LEGAL_UPDATED}</Text>
      {d.sections.map(([h, body]) => (
        <View key={h} style={s.section}>
          <Text style={s.h}>{h}</Text>
          <Text style={s.body}>{body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 20, paddingBottom: 60, maxWidth: 760, width: "100%", alignSelf: "center" },
  title: { color: c.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.6, marginTop: 22 },
  updated: { color: c.muted, fontSize: 13, marginTop: 4, marginBottom: 8 },
  section: { marginTop: 18 },
  h: { color: c.text, fontSize: 16, fontWeight: "800", marginBottom: 6 },
  body: { color: c.textSecondary, fontSize: 15, lineHeight: 23 },
}));
