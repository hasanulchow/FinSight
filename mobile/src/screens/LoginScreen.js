import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import { makeStyles, useTheme, font } from "../theme";
import { BackButton, Banner, Button, Input, Segmented } from "../components/ui";
import { Logo, LogoGlyph } from "../components/Brand";
import NavIcon from "../components/NavIcon";

function friendlyAuthError(error) {
  const text = error.message || "";
  if (/failed to fetch|network request failed|load failed/i.test(text)) return "Can't reach Supabase. Check EXPO_PUBLIC_SUPABASE_URL and your connection.";
  if (/invalid api key/i.test(text)) return "Supabase rejected the API key. Check EXPO_PUBLIC_SUPABASE_ANON_KEY.";
  if (/email not confirmed/i.test(text)) return "Confirm your email first (check your inbox), then sign in.";
  if (/invalid login credentials/i.test(text)) return "Wrong email or password.";
  if (/rate limit/i.test(text)) return "Too many attempts. Wait a minute and try again.";
  return text;
}

const POINTS = [
  { icon: "today", text: "A morning brief on every stock you follow" },
  { icon: "copilot", text: "An AI Copilot that shows its sources" },
  { icon: "trade", text: "Practice trading with $100,000" },
  { icon: "journal", text: "A journal and coach that fix costly habits" },
];

export default function LoginScreen({ initialMode = "signin", onBack, onOpenLegal }) {
  const { c } = useTheme();
  const s = useStyles();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [mode, setMode] = useState(initialMode);
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
    if (mode === "signup" && !data.session) setMessage({ type: "success", text: "Almost there. Check your inbox to confirm your email, then sign in." });
  }

  const form = (
    <View style={s.formWrap}>
      {onBack && <BackButton onPress={onBack} label="Home" />}
      {!wide && <View style={{ marginTop: onBack ? 18 : 8 }}><Logo size={40} nameSize={24} /></View>}
      <Text style={s.title}>{mode === "signin" ? "Welcome back" : "Create your account"}</Text>
      <Text style={s.subtitle}>{mode === "signin" ? "Sign in to your trading desk." : "Free to start. No credit card needed."}</Text>

      <View style={{ marginTop: 24 }}>
        <Segmented options={[["signin", "Sign in"], ["signup", "Create account"]]} value={mode} onChange={(m) => { setMode(m); setMessage(null); }} />
      </View>

      <Text style={s.label}>Email</Text>
      <Input icon="mail-outline" placeholder="you@example.com" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />

      <Text style={s.label}>Password</Text>
      <Input
        icon="lock-closed-outline"
        placeholder="At least 6 characters"
        secureTextEntry={!showPassword}
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        right={
          <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10} accessibilityLabel={showPassword ? "Hide password" : "Show password"}>
            <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={c.muted} />
          </Pressable>
        }
      />

      {message && <Banner tone={message.type}>{message.text}</Banner>}

      <Button title={mode === "signin" ? "Sign in" : "Create account"} iconRight="arrow-forward" onPress={submit} loading={busy} size="lg" style={{ marginTop: 22 }} />
      <Text style={s.legal}>
        {mode === "signup" ? "By creating an account you agree to the " : "Educational research only, not investment advice. "}
        <Text style={{ fontWeight: "700", fontFamily: font("700") }} onPress={() => onOpenLegal?.("terms")}>Terms</Text>,{" "}
        <Text style={{ fontWeight: "700", fontFamily: font("700") }} onPress={() => onOpenLegal?.("privacy")}>Privacy Policy</Text> and{" "}
        <Text style={{ fontWeight: "700", fontFamily: font("700") }} onPress={() => onOpenLegal?.("disclaimer")}>Risk Disclaimer</Text>.
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {wide ? (
        <View style={[s.fill, { flexDirection: "row" }]}>
          <LinearGradient colors={["#4F46E5", "#7C3AED", "#4C1D95"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.brandPanel}>
            <View style={s.brandGlyph} pointerEvents="none">
              <LogoGlyph size={420} color="rgba(255,255,255,0.07)" accent="rgba(34,211,238,0.22)" />
            </View>
            <Logo size={34} tone="light" />
            <View>
              <Text style={s.brandTitle}>Your AI trading desk.</Text>
              <Text style={s.brandLead}>Research, practice and trade with a team of AI analysts at your side.</Text>
              <View style={{ marginTop: 30, gap: 14 }}>
                {POINTS.map((p) => (
                  <View key={p.text} style={s.point}>
                    <View style={s.pointIcon}><NavIcon name={p.icon} size={19} color="#FFFFFF" /></View>
                    <Text style={s.pointText}>{p.text}</Text>
                  </View>
                ))}
              </View>
            </View>
            <Text style={s.brandFoot}>Filings from SEC EDGAR · Market data from Finnhub and Massive · Educational, not investment advice</Text>
          </LinearGradient>
          <ScrollView style={s.fill} contentContainerStyle={s.formCenter} keyboardShouldPersistTaps="handled">{form}</ScrollView>
        </View>
      ) : (
        <ScrollView style={s.fill} contentContainerStyle={{ flexGrow: 1, padding: 22, paddingTop: 12 }} keyboardShouldPersistTaps="handled">
          {form}
          <View style={s.pointsNarrow}>
            {POINTS.map((p) => (
              <View key={p.text} style={s.pointNarrow}>
                <NavIcon name={p.icon} size={18} color={c.primary} active />
                <Text style={s.pointNarrowText}>{p.text}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  fill: { flex: 1, backgroundColor: c.bg },
  brandPanel: { width: "44%", maxWidth: 620, padding: 48, justifyContent: "space-between", overflow: "hidden" },
  brandGlyph: { position: "absolute", right: -120, bottom: -110 },
  brandTitle: { color: "#FFFFFF", fontSize: 44, lineHeight: 49, fontWeight: "800", letterSpacing: -1.6, maxWidth: 460 },
  brandLead: { color: "rgba(255,255,255,0.82)", fontSize: 17, lineHeight: 26, marginTop: 14, maxWidth: 420 },
  point: { flexDirection: "row", alignItems: "center", gap: 12 },
  pointIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  pointText: { color: "rgba(255,255,255,0.92)", fontSize: 16, flex: 1 },
  brandFoot: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  formCenter: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  formWrap: { width: "100%", maxWidth: 420 },
  title: { color: c.text, fontSize: 32, fontWeight: "800", letterSpacing: -1.1, marginTop: 22 },
  subtitle: { color: c.textSecondary, fontSize: 15, marginTop: 6 },
  label: { fontWeight: "600", color: c.text, marginTop: 18, marginBottom: 8, fontSize: 14 },
  legal: { color: c.muted, fontSize: 12, marginTop: 16, textAlign: "center" },
  pointsNarrow: { marginTop: 32, gap: 12, padding: 18, backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.border },
  pointNarrow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pointNarrowText: { color: c.textSecondary, fontSize: 14, flex: 1 },
}));
