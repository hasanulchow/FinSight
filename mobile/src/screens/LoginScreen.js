import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { colors } from "../theme";
import { PrimaryButton } from "../components/ui";

function friendlyAuthError(error) {
  const text = error.message || "";
  if (/failed to fetch|network request failed|load failed/i.test(text)) return "Can't reach Supabase. Check EXPO_PUBLIC_SUPABASE_URL and your connection.";
  if (/invalid api key/i.test(text)) return "Supabase rejected the API key. Check EXPO_PUBLIC_SUPABASE_ANON_KEY.";
  if (/email not confirmed/i.test(text)) return "Confirm your email first (check your inbox), then sign in.";
  if (/invalid login credentials/i.test(text)) return "Wrong email or password.";
  if (/rate limit/i.test(text)) return "Too many attempts. Wait a minute and try again.";
  return text;
}

const FEATURES = [
  { icon: "flash-outline", color: "#F59E0B", text: "A full stock briefing in about a minute" },
  { icon: "document-text-outline", color: "#10B981", text: "Built from live quotes and SEC filings" },
  { icon: "shield-checkmark-outline", color: "#60A5FA", text: "Compliance-reviewed and quality-scored" },
];

export default function LoginScreen() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function submit() {
    if (!email.includes("@")) return setMessage({ type: "error", text: "Enter a valid email address." });
    if (password.length < 6) return setMessage({ type: "error", text: "Passwords need at least 6 characters." });
    setBusy(true);
    setMessage(null);
    // On web, the confirmation email links back to this site instead of Supabase's Site URL.
    const emailRedirectTo = Platform.OS === "web" ? window.location.origin : undefined;
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo } });
    setBusy(false);
    if (error) return setMessage({ type: "error", text: friendlyAuthError(error) });
    if (mode === "signup" && !data.session) setMessage({ type: "info", text: "Almost there. Check your inbox to confirm your email, then sign in." });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.logoBadge}>
            <Ionicons name="trending-up" size={30} color={colors.primary} />
          </View>
          <Text style={styles.logo}>FinSight</Text>
          <Text style={styles.tagline}>Your AI research team for client conversations</Text>
          <View style={{ marginTop: 20, gap: 10 }}>
            {FEATURES.map((f) => (
              <View key={f.text} style={styles.feature}>
                <Ionicons name={f.icon} size={18} color={f.color} />
                <Text style={styles.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.tabs}>
            {[["signin", "Sign in"], ["signup", "Create account"]].map(([key, label]) => (
              <Pressable key={key} style={[styles.tab, mode === key && styles.tabActive]} onPress={() => { setMode(key); setMessage(null); }}>
                <Text style={[styles.tabText, mode === key && styles.tabTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Work email</Text>
          <View style={styles.inputRow}>
            <Ionicons name="mail-outline" size={18} color={colors.muted} />
            <TextInput style={styles.input} placeholder="name@firm.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          </View>

          <Text style={styles.label}>Password</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.muted} />
            <TextInput style={styles.input} placeholder="At least 6 characters" secureTextEntry={!showPassword} value={password} onChangeText={setPassword} onSubmitEditing={submit} />
            <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10} accessibilityLabel={showPassword ? "Hide password" : "Show password"}>
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={colors.muted} />
            </Pressable>
          </View>

          {message && (
            <View style={[styles.message, { backgroundColor: message.type === "error" ? colors.redSoft : colors.primarySoft }]}>
              <Ionicons name={message.type === "error" ? "alert-circle-outline" : "mail-unread-outline"} size={18} color={message.type === "error" ? colors.red : colors.primary} />
              <Text style={{ flex: 1, color: message.type === "error" ? colors.red : colors.primaryDark }}>{message.text}</Text>
            </View>
          )}

          <PrimaryButton
            title={mode === "signin" ? "Sign in" : "Create account"}
            icon={mode === "signin" ? "log-in-outline" : "person-add-outline"}
            onPress={submit}
            loading={busy}
            style={{ marginTop: 18 }}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.primary, padding: 28, paddingTop: 40, paddingBottom: 60, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  logoBadge: { width: 58, height: 58, borderRadius: 18, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 34, fontWeight: "800", color: colors.white, marginTop: 14 },
  tagline: { fontSize: 16, color: "#C7D2FE", marginTop: 4 },
  feature: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12, padding: 10 },
  featureText: { color: colors.white, fontSize: 14, flex: 1 },
  card: { backgroundColor: colors.card, marginHorizontal: 20, marginTop: -36, borderRadius: 22, padding: 20, shadowColor: "#1E1B4B", shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4, marginBottom: 30 },
  tabs: { flexDirection: "row", backgroundColor: colors.bg, borderRadius: 12, padding: 4, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  tabActive: { backgroundColor: colors.card, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  tabText: { color: colors.muted, fontWeight: "600" },
  tabTextActive: { color: colors.primary },
  label: { fontWeight: "600", color: colors.text, marginTop: 14, marginBottom: 6 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, backgroundColor: "#FAFAFF" },
  input: { flex: 1, paddingVertical: 13, fontSize: 16, color: colors.text },
  message: { flexDirection: "row", gap: 8, alignItems: "center", borderRadius: 12, padding: 12, marginTop: 14 },
});
