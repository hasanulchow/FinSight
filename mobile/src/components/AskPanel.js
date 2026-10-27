import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import { colors } from "../theme";
import { SectionCard } from "./ui";

const askSection = { color: "#4F46E5", soft: "#EEF2FF", icon: "chatbubble-ellipses-outline" };
const SUGGESTIONS = ["What are the biggest risks?", "How does it make money?", "What did management say about the outlook?"];

/** "Ask the 10-K": follow-up questions answered from the filing, with citations. Remembers the conversation. */
export default function AskPanel({ briefingId }) {
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
      setError(e.message);
      setMessages((m) => m.filter((x) => !String(x.id).startsWith("pending-")));
      setQuestion(q);
    }
    setBusy(false);
  }

  return (
    <SectionCard title="Ask the 10-K" section={askSection}>
      <Text style={styles.muted}>Answers come only from the company's latest annual report, with citations.</Text>

      {messages.length === 0 && (
        <View style={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <Pressable key={s} style={styles.suggestion} onPress={() => send(s)} disabled={busy}>
              <Text style={styles.suggestionText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {messages.map((m) => (
        <View key={m.id} style={[styles.bubble, m.role === "user" ? styles.userBubble : styles.aiBubble]}>
          <Text style={m.role === "user" ? styles.userText : styles.aiText}>{m.content}</Text>
          {m.citations?.length > 0 && (
            <View style={styles.citations}>
              {m.citations.map((c) => {
                const key = `${m.id}-${c.n}`;
                return (
                  <Pressable key={key} onPress={() => setOpenCitation(openCitation === key ? null : key)}>
                    <Text style={styles.citation}>[{c.n}] {c.section}</Text>
                    {openCitation === key && <Text style={styles.excerpt}>“{c.excerpt}…”</Text>}
                  </Pressable>
                );
              })}
            </View>
          )}
          {m.evaluation && <Text style={styles.score}>Answer quality {m.evaluation.overall}/5</Text>}
        </View>
      ))}

      {busy && (
        <View style={styles.thinking}>
          <ActivityIndicator color={askSection.color} size="small" />
          <Text style={styles.muted}>Searching the filing…</Text>
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Ask about risks, segments, guidance…"
          placeholderTextColor={colors.muted}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => send()}
          returnKeyType="send"
          editable={!busy}
        />
        <Pressable style={[styles.send, (!question.trim() || busy) && { opacity: 0.4 }]} onPress={() => send()} disabled={!question.trim() || busy} accessibilityLabel="Send question">
          <Ionicons name="arrow-up" size={20} color={colors.white} />
        </Pressable>
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 13 },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  suggestion: { backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  suggestionText: { color: colors.primary, fontWeight: "600", fontSize: 13 },
  bubble: { borderRadius: 16, padding: 12, marginTop: 10, maxWidth: "92%" },
  userBubble: { backgroundColor: colors.primary, alignSelf: "flex-end", borderBottomRightRadius: 4 },
  aiBubble: { backgroundColor: colors.bg, alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  userText: { color: colors.white, fontSize: 14, lineHeight: 20 },
  aiText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  citations: { marginTop: 8, gap: 4 },
  citation: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  excerpt: { color: colors.muted, fontSize: 12, fontStyle: "italic", marginTop: 2, lineHeight: 17 },
  score: { color: colors.muted, fontSize: 11, marginTop: 6 },
  thinking: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 10 },
  error: { color: colors.red, marginTop: 8 },
  inputRow: { flexDirection: "row", gap: 8, marginTop: 12, alignItems: "center" },
  input: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.text },
  send: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
