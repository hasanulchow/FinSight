import { Text, View } from "react-native";
import { makeStyles, useTheme } from "../theme";

// Minimal Markdown for agent answers: headings, **bold**, bullet and numbered lists, paragraphs.

function Inline({ text, style }) {
  const s = useStyles();
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <Text key={i} style={s.bold}>{p.slice(2, -2)}</Text> : p))}
    </Text>
  );
}

export default function Markdown({ text = "" }) {
  const { c } = useTheme();
  const s = useStyles();
  const blocks = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ type: "gap" });
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)$/) ?? line.match(/^\*\*([^*]+)\*\*:?$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (heading) blocks.push({ type: "h", text: heading[1] });
    else if (bullet) blocks.push({ type: "li", text: bullet[1], indent: /^\s{2,}/.test(line) });
    else if (numbered) blocks.push({ type: "ol", n: numbered[1], text: numbered[2] });
    else blocks.push({ type: "p", text: line });
  }
  return (
    <View>
      {blocks.map((b, i) => {
        if (b.type === "gap") return i && blocks[i - 1]?.type !== "gap" ? <View key={i} style={{ height: 8 }} /> : null;
        if (b.type === "h") return <Text key={i} style={[s.h, i === 0 && { marginTop: 0 }]}>{b.text}</Text>;
        if (b.type === "li" || b.type === "ol") {
          return (
            <View key={i} style={[s.li, b.indent && { paddingLeft: 16 }]}>
              {b.type === "li" ? <View style={[s.dot, { backgroundColor: c.primary }]} /> : <Text style={s.num}>{b.n}.</Text>}
              <Inline text={b.text} style={s.body} />
            </View>
          );
        }
        return <Inline key={i} text={b.text} style={[s.body, { marginBottom: 2 }]} />;
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  h: { color: c.text, fontWeight: "800", fontSize: 16, marginTop: 6, marginBottom: 6, letterSpacing: -0.2 },
  body: { flex: 1, color: c.text, fontSize: 15, lineHeight: 22 },
  bold: { fontWeight: "800" },
  li: { flexDirection: "row", gap: 10, marginBottom: 6 },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 9 },
  num: { color: c.primary, fontWeight: "800", fontSize: 14, lineHeight: 22, minWidth: 16 },
}));
