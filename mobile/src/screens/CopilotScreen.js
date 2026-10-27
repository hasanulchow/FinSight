import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "../lib/api";
import { makeStyles, useTheme } from "../theme";
import { Button, Disclaimer } from "../components/ui";
import Markdown from "../components/Markdown";
import { ErrorNotice } from "../components/Upgrade";

const SUGGESTIONS = [
  { icon: "analytics-outline", text: "How does NVDA look technically, and any red flags?" },
  { icon: "pie-chart-outline", text: "How is my portfolio doing vs the S&P 500?" },
  { icon: "journal-outline", text: "What's my biggest leak in my trading journal?" },
  { icon: "calculator-outline", text: "Size a trade: $25k account, 1% risk, AAPL with an ATR stop" },
  { icon: "options-outline", text: "What's the expected move for TSLA options this week?" },
  { icon: "flask-outline", text: "Backtest an RSI dip-buy strategy on SPY" },
];

// Friendly names for the agent's tools in the "what I did" trace
const TOOL_LABELS = {
  get_stock_snapshot: "Price & technicals",
  get_earnings_and_insiders: "Earnings & insiders",
  check_red_flags: "Red-flag scan",
  search_annual_report: "Searched the 10-K",
  get_options_overview: "Options chain",
  analyze_option_strategy: "Strategy payoff",
  run_backtest: "Backtest",
  screen_stocks: "Screener",
  get_market_overview: "Market overview",
  compare_performance: "Performance compare",
  get_portfolio: "Your portfolio",
  compare_portfolio_to_benchmark: "Portfolio vs SPY",
  get_journal_stats: "Your journal",
  calculate_position_size: "Position size",
  list_alerts: "Your alerts",
  create_alert: "Proposed an alert",
  add_holding: "Proposed a holding",
  log_trade: "Proposed a journal entry",
};

/** AI Copilot: an agent that calls FinSight's tools to answer, and proposes changes the user confirms. */
export default function CopilotScreen({ onOpenStock }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const sec = sections.copilot;
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null); // null = hidden
  const scroller = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length, busy]);

  async function send(text = input) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: q }]);
    try {
      const r = await api.copilotChat(q, conversationId);
      setConversationId(r.conversation_id);
      setMessages((m) => [...m, { ...r.message, actions: r.actions, trace: r.trace }]);
    } catch (e) {
      setError(e);
      setMessages((m) => m.slice(0, -1));
      setInput(q);
    }
    setBusy(false);
  }

  async function decide(messageId, action, decision) {
    const update = (fields) => setMessages((m) => m.map((msg) => (msg.id === messageId ? { ...msg, actions: msg.actions.map((a) => (a.id === action.id ? { ...a, ...fields } : a)) } : msg)));
    update({ busy: true });
    try {
      const r = await api.copilotAction(action.id, decision);
      update({ busy: false, status: r.status });
    } catch (e) {
      update({ busy: false, error: e.message });
    }
  }

  async function openHistory() {
    setHistory([]);
    setHistory(await api.copilotConversations().catch(() => []));
  }

  async function openConversation(id) {
    setHistory(null);
    setBusy(true);
    try {
      setMessages(await api.copilotMessages(id));
      setConversationId(id);
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setError(null);
    setHistory(null);
  }

  const empty = !messages.length && !busy;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.topBar}>
        <View style={[s.topIcon, { backgroundColor: sec.soft }]}>
          <Ionicons name="sparkles" size={16} color={sec.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.topTitle}>Copilot</Text>
          <Text style={s.topSub}>Research agent with 18 tools</Text>
        </View>
        <Button title="History" icon="time-outline" variant="ghost" size="sm" onPress={history ? () => setHistory(null) : openHistory} />
        {!empty && <Button title="New" icon="add" variant="secondary" size="sm" onPress={newChat} />}
      </View>

      {history && (
        <View style={s.history}>
          {!history.length ? (
            <Text style={s.muted}>No past conversations yet.</Text>
          ) : (
            history.map((h) => (
              <Pressable key={h.id} onPress={() => openConversation(h.id)} style={({ hovered }) => [s.historyRow, hovered && { backgroundColor: c.surfaceAlt }]}>
                <Ionicons name="chatbubble-outline" size={15} color={c.muted} />
                <Text style={s.historyText} numberOfLines={1}>{h.title || "Conversation"}</Text>
                <Text style={s.muted}>{new Date(h.updated_at).toLocaleDateString()}</Text>
              </Pressable>
            ))
          )}
        </View>
      )}

      <ScrollView ref={scroller} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {empty ? (
          <View style={s.hero}>
            <LinearGradient colors={c.brand.slice(0, 2)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroIcon}>
              <Ionicons name="sparkles" size={28} color="#FFFFFF" />
            </LinearGradient>
            <Text style={s.heroTitle}>What do you want to know?</Text>
            <Text style={s.heroText}>
              I pull live prices, charts, filings, options, your portfolio and your journal, then explain what I find. I can also set alerts and log trades once you confirm.
            </Text>
            <View style={s.suggestions}>
              {SUGGESTIONS.map((x) => (
                <Pressable key={x.text} onPress={() => send(x.text)} style={({ hovered, pressed }) => [s.suggestion, hovered && { borderColor: sec.color }, pressed && { opacity: 0.85 }]}>
                  <Ionicons name={x.icon} size={17} color={sec.color} />
                  <Text style={s.suggestionText}>{x.text}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <View key={m.id} style={s.userBubble}>
                <Text style={s.userText}>{m.content}</Text>
              </View>
            ) : (
              <AssistantMessage key={m.id} message={m} onDecide={(a, d) => decide(m.id, a, d)} onOpenStock={onOpenStock} />
            ),
          )
        )}
        {busy && (
          <View style={s.thinking}>
            <ActivityIndicator color={sec.color} size="small" />
            <Text style={s.muted}>Working: calling tools and reading the results…</Text>
          </View>
        )}
        <ErrorNotice error={error} />
        {!empty && <Disclaimer>Copilot is an AI research assistant. It can be wrong, and it is not investment advice.</Disclaimer>}
      </ScrollView>

      <View style={s.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask about a stock, your portfolio, a trade…"
          placeholderTextColor={c.muted}
          style={s.input}
          multiline
          onKeyPress={(e) => {
            if (Platform.OS === "web" && e.nativeEvent.key === "Enter" && !e.nativeEvent.shiftKey) {
              e.preventDefault?.();
              send();
            }
          }}
        />
        <Pressable onPress={() => send()} disabled={busy || !input.trim()} style={[s.send, { backgroundColor: input.trim() && !busy ? c.primary : c.surfaceAlt }]} accessibilityLabel="Send">
          <Ionicons name="arrow-up" size={20} color={input.trim() && !busy ? c.onPrimary : c.muted} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function AssistantMessage({ message, onDecide, onOpenStock }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  const [showTrace, setShowTrace] = useState(false);
  const trace = message.trace ?? [];
  const tickers = [...new Set(trace.map((t) => t.input?.ticker).filter(Boolean).map((t) => String(t).toUpperCase()))];
  return (
    <View style={s.assistant}>
      {trace.length > 0 && (
        <Pressable onPress={() => setShowTrace((v) => !v)} style={s.traceHead}>
          <Ionicons name="construct-outline" size={13} color={c.muted} />
          <Text style={s.traceSummary} numberOfLines={showTrace ? undefined : 1}>
            Used {trace.length} tool{trace.length > 1 ? "s" : ""}: {[...new Set(trace.map((t) => TOOL_LABELS[t.tool] ?? t.tool))].join(", ")}
          </Text>
          <Ionicons name={showTrace ? "chevron-up" : "chevron-down"} size={14} color={c.muted} />
        </Pressable>
      )}
      {showTrace && (
        <View style={s.traceList}>
          {trace.map((t, i) => (
            <View key={i} style={s.traceRow}>
              <Ionicons name={t.ok ? "checkmark-circle" : "close-circle"} size={14} color={t.ok ? c.gain : c.loss} />
              <Text style={s.traceText} numberOfLines={1}>
                {TOOL_LABELS[t.tool] ?? t.tool}
                {t.input?.ticker ? ` · ${String(t.input.ticker).toUpperCase()}` : ""}
                {t.error ? ` · ${t.error}` : ""}
              </Text>
              {t.ms != null && <Text style={s.muted}>{(t.ms / 1000).toFixed(1)}s</Text>}
            </View>
          ))}
        </View>
      )}
      <Markdown text={message.content} />

      {(message.actions ?? []).map((a) => (
        <View key={a.id} style={[s.action, { borderColor: a.status === "pending" ? sections.copilot.color : c.border }]}>
          <View style={s.actionHead}>
            <Ionicons name={a.status === "confirmed" ? "checkmark-circle" : a.status === "cancelled" ? "close-circle" : "hand-left-outline"} size={17} color={a.status === "confirmed" ? c.gain : a.status === "cancelled" ? c.muted : sections.copilot.color} />
            <Text style={s.actionText}>{a.summary}</Text>
          </View>
          {a.status === "pending" ? (
            <View style={s.actionButtons}>
              <Button title="Confirm" icon="checkmark" size="sm" onPress={() => onDecide(a, "confirm")} loading={a.busy} />
              <Button title="Cancel" variant="ghost" size="sm" onPress={() => onDecide(a, "cancel")} disabled={a.busy} />
            </View>
          ) : (
            <Text style={[s.muted, { marginTop: 6 }]}>{a.status === "confirmed" ? "Done" : a.status === "cancelled" ? "Cancelled" : a.status}</Text>
          )}
          {a.error && <Text style={s.error}>{a.error}</Text>}
        </View>
      ))}

      {tickers.length > 0 && onOpenStock && (
        <View style={s.tickerRow}>
          {tickers.slice(0, 4).map((t) => (
            <Pressable key={t} onPress={() => onOpenStock(t)} style={({ hovered }) => [s.tickerChip, hovered && { backgroundColor: c.primarySoft }]}>
              <Text style={s.tickerChipText}>{t}</Text>
              <Ionicons name="arrow-forward" size={12} color={c.primary} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  topBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  topIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  topTitle: { color: c.text, fontWeight: "800", fontSize: 17 },
  topSub: { color: c.muted, fontSize: 12 },
  history: { marginHorizontal: 16, marginTop: 10, padding: 8, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, maxHeight: 280 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10 },
  historyText: { flex: 1, color: c.text, fontSize: 14 },
  scroll: { padding: 16, paddingBottom: 24, flexGrow: 1 },
  hero: { alignItems: "center", paddingTop: 24, paddingBottom: 10 },
  heroIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  heroTitle: { color: c.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.6, marginTop: 18, textAlign: "center" },
  heroText: { color: c.textSecondary, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 8, maxWidth: 520 },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 24, justifyContent: "center", maxWidth: 760 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, flexBasis: 320, flexGrow: 1, maxWidth: 372 },
  suggestionText: { flex: 1, color: c.text, fontSize: 14, fontWeight: "600", lineHeight: 19 },
  userBubble: { alignSelf: "flex-end", backgroundColor: c.primary, borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 16, paddingVertical: 11, maxWidth: "85%", marginBottom: 14 },
  userText: { color: c.onPrimary, fontSize: 15, lineHeight: 21 },
  assistant: { backgroundColor: c.surface, borderRadius: 20, borderTopLeftRadius: 6, borderWidth: 1, borderColor: c.border, padding: 16, marginBottom: 14 },
  traceHead: { flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 10, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  traceSummary: { flex: 1, color: c.muted, fontSize: 12, fontWeight: "600" },
  traceList: { backgroundColor: c.surfaceAlt, borderRadius: 12, padding: 10, marginBottom: 12, gap: 6 },
  traceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  traceText: { flex: 1, color: c.textSecondary, fontSize: 12 },
  action: { borderWidth: 1.5, borderRadius: 14, padding: 12, marginTop: 12, backgroundColor: c.surfaceAlt },
  actionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  actionText: { flex: 1, color: c.text, fontWeight: "700", fontSize: 14 },
  actionButtons: { flexDirection: "row", gap: 8, marginTop: 10 },
  tickerRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  tickerChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: c.border },
  tickerChipText: { color: c.primary, fontWeight: "800", fontSize: 12 },
  thinking: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignSelf: "flex-start" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface },
  input: { flex: 1, minHeight: 46, maxHeight: 140, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 15, color: c.text, outlineStyle: "none" },
  send: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  muted: { color: c.muted, fontSize: 12 },
  error: { color: c.loss, fontSize: 12, marginTop: 6 },
}));
