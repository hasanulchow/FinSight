import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { ErrorNotice } from "./Upgrade";
import { Chip, SectionCard } from "./ui";

const SUGGESTIONS = ["What are the biggest risks?", "How does it make money?", "What did management say about the outlook?"];

/** "Ask the 10-K": follow-up questions answered from the filing, with citations. Remembers the conversation. */
export default function AskPanel({ briefingId }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [openCitation, setOpenCitation] = useState(null);

  useEffect(() => {
    api.chat(briefingId).then(setMessages).catch(() => {});
  }, [briefingId]);

  async function send(text = question) {
    const q = text.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setQuestion("");
    setMessages((m) => [...m, { id: `pending-${Date.now()}`, role: "user", content: q }]);
    try {
      const { question: saved, answer } = await api.ask(briefingId, q);
      setMessages((m) => [...m.filter((x) => !String(x.id).startsWith("pending-")), saved, answer]);
    } catch (e) {
      setError(e);
      setMessages((m) => m.filter((x) => !String(x.id).startsWith("pending-")));
      setQuestion(q);
    }
    setBusy(false);
  }

  return (
    <SectionCard title="Ask the 10-K" subtitle="Answers cite the company's latest annual report" section={sections.ask}>
      {messages.length === 0 && (
        <View style={s.suggestions}>
          {SUGGESTIONS.map((q) => <Chip key={q} label={q} icon="sparkles-outline" onPress={() => send(q)} />)}
        </View>
      )}

      {messages.map((m) => (
        <View key={m.id} style={[s.bubble, m.role === "user" ? s.userBubble : s.aiBubble]}>
          <Text style={m.role === "user" ? s.userText : s.aiText}>{m.content}</Text>
          {m.citations?.length > 0 && (
            <View style={s.citations}>
              {m.citations.map((cit) => {
                const key = `${m.id}-${cit.n}`;
                return (
                  <Pressable key={key} onPress={() => setOpenCitation(openCitation === key ? null : key)}>
                    <Text style={s.citation}>[{cit.n}] {cit.section}</Text>
                    {openCitation === key && <Text style={s.excerpt}>“{cit.excerpt}…”</Text>}
                  </Pressable>
                );
              })}
            </View>
          )}
          {m.evaluation && <Text style={s.score}>Answer quality {m.evaluation.overall}/5</Text>}
        </View>
      ))}

      {busy && (
        <View style={s.thinking}>
          <ActivityIndicator color={c.primary} size="small" />
          <Text style={s.muted}>Searching the filing…</Text>
        </View>
      )}
      {error && (error.upgrade ? <ErrorNotice error={error} /> : <Text style={s.error}>{error.message ?? error}</Text>)}

      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          placeholder="Ask about risks, segments, guidance…"
          placeholderTextColor={c.muted}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => send()}
          returnKeyType="send"
          editable={!busy}
        />
        <Pressable style={[s.send, (!question.trim() || busy) && { opacity: 0.35 }]} onPress={() => send()} disabled={!question.trim() || busy} accessibilityLabel="Send question">
          <Ionicons name="arrow-up" size={19} color={c.onPrimary} />
        </Pressable>
      </View>
    </SectionCard>
  );
}

const useStyles = makeStyles((c) => ({
  muted: { color: c.muted, fontSize: 13 },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bubble: { borderRadius: 18, padding: 13, marginTop: 10, maxWidth: "92%" },
  userBubble: { backgroundColor: c.primary, alignSelf: "flex-end", borderBottomRightRadius: 6 },
  aiBubble: { backgroundColor: c.surfaceAlt, alignSelf: "flex-start", borderBottomLeftRadius: 6 },
  userText: { color: c.onPrimary, fontSize: 14, lineHeight: 20 },
  aiText: { color: c.text, fontSize: 14, lineHeight: 21 },
  citations: { marginTop: 8, gap: 4 },
  citation: { color: c.primary, fontSize: 12, fontWeight: "700" },
  excerpt: { color: c.textSecondary, fontSize: 12, fontStyle: "italic", marginTop: 2, lineHeight: 17 },
  score: { color: c.muted, fontSize: 11, marginTop: 6 },
  thinking: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 12 },
  error: { color: c.loss, marginTop: 8 },
  inputRow: { flexDirection: "row", gap: 8, marginTop: 14, alignItems: "center", backgroundColor: c.surfaceAlt, borderRadius: 16, borderWidth: 1, borderColor: c.border, paddingLeft: 14, padding: 4 },
  input: { flex: 1, paddingVertical: 10, fontSize: 15, color: c.text, outlineStyle: "none" },
  send: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" },
}));
