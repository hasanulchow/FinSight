import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { makeStyles, radius, type, useTheme } from "../theme";

// Shared building blocks. Every color comes from the active theme (light or dark).

export function Logo({ size = 36, withName = true, nameSize }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.logoRow}>
      <LinearGradient colors={c.brand.slice(0, 2)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size * 0.3, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="trending-up" size={size * 0.58} color="#FFFFFF" />
      </LinearGradient>
      {withName && <Text style={[s.logoText, nameSize && { fontSize: nameSize }]}>FinSight</Text>}
    </View>
  );
}

export function Card({ children, style, padded = true }) {
  const s = useStyles();
  return <View style={[s.card, padded && s.cardPad, style]}>{children}</View>;
}

/** Card with a colored icon badge in the header; `section` comes from theme.sections. */
export function SectionCard({ title, subtitle, section, right, children, style }) {
  const { c } = useTheme();
  const s = useStyles();
  const color = section?.color ?? c.primary;
  return (
    <View style={[s.card, s.cardPad, s.section, style]}>
      <View style={s.sectionHeader}>
        {section?.icon && (
          <View style={[s.iconBadge, { backgroundColor: section.soft ?? c.soft(color) }]}>
            <Ionicons name={section.icon} size={17} color={color} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={s.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function PageHeader({ eyebrow, title, subtitle, right }) {
  const s = useStyles();
  return (
    <View style={s.pageHeader}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
        <Text style={s.pageTitle}>{title}</Text>
        {subtitle ? <Text style={s.pageSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function BackButton({ onPress, label = "Back" }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.back, pressed && { opacity: 0.6 }]} hitSlop={10} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name="chevron-back" size={20} color={c.primary} />
      <Text style={s.backText}>{label}</Text>
    </Pressable>
  );
}

export function Bullets({ items = [], color }) {
  const { c } = useTheme();
  const s = useStyles();
  return items.map((t, i) => (
    <View key={i} style={s.bulletRow}>
      <View style={[s.dot, { backgroundColor: color ?? c.primary }]} />
      <Text style={s.bulletText}>{t}</Text>
    </View>
  ));
}

export function Pill({ text, color, icon }) {
  const { c } = useTheme();
  const s = useStyles();
  const col = color ?? c.primary;
  return (
    <View style={[s.pill, { backgroundColor: c.soft(col.startsWith("#") ? col : c.primary) }]}>
      {icon && <Ionicons name={icon} size={11} color={col} />}
      <Text style={[s.pillText, { color: col }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

export function TickerAvatar({ ticker = "", size = 44 }) {
  const theme = useTheme();
  const color = theme.tickerColor(ticker);
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: theme.c.soft(color), alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color, fontWeight: "800", fontSize: Math.max(10, size * (ticker.length > 3 ? 0.24 : 0.3)), letterSpacing: -0.3 }}>{ticker.slice(0, 4)}</Text>
    </View>
  );
}

export function ScoreBar({ label, value }) {
  const theme = useTheme();
  const s = useStyles();
  const color = theme.scoreColor(value);
  return (
    <View style={s.scoreRow}>
      <Text style={s.scoreLabel}>{label}</Text>
      <View style={s.track}>
        <View style={[s.fill, { width: `${(value / 5) * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={[s.scoreValue, { color }]}>{value}/5</Text>
    </View>
  );
}

/** variant: primary | secondary | ghost | danger. size: md | lg | sm */
export function Button({ title, icon, iconRight, onPress, loading, disabled, variant = "primary", size = "md", style, accessibilityLabel }) {
  const { c } = useTheme();
  const s = useStyles();
  const fg = variant === "primary" ? c.onPrimary : variant === "danger" ? c.loss : c.primary;
  const pad = size === "lg" ? 17 : size === "sm" ? 9 : 14;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed, hovered }) => [
        s.button,
        { paddingVertical: pad, paddingHorizontal: size === "sm" ? 12 : 18 },
        variant === "primary" && { backgroundColor: c.primary },
        variant === "secondary" && { backgroundColor: c.primarySoft },
        variant === "ghost" && { backgroundColor: "transparent", borderWidth: 1, borderColor: c.border },
        variant === "danger" && { backgroundColor: c.lossSoft },
        hovered && { opacity: 0.92 },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
        (disabled || loading) && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Ionicons name={icon} size={size === "sm" ? 15 : 18} color={fg} /> : null}
      {title ? <Text style={[s.buttonText, { color: fg }, size === "sm" && { fontSize: 13 }, size === "lg" && { fontSize: 16 }]}>{title}</Text> : null}
      {iconRight && !loading ? <Ionicons name={iconRight} size={18} color={fg} /> : null}
    </Pressable>
  );
}

export const PrimaryButton = (props) => <Button variant="primary" {...props} />;

export function IconButton({ icon, onPress, label, tone, size = 40 }) {
  const { c } = useTheme();
  const color = tone ?? c.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed, hovered }) => [{ width: size, height: size, borderRadius: size * 0.32, alignItems: "center", justifyContent: "center", backgroundColor: hovered || pressed ? c.surfaceAlt : "transparent" }]}
    >
      <Ionicons name={icon} size={size * 0.5} color={color} />
    </Pressable>
  );
}

export function Chip({ label, active, onPress, icon, color }) {
  const { c } = useTheme();
  const s = useStyles();
  const col = color ?? c.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed, hovered }) => [s.chip, active ? { backgroundColor: col, borderColor: col } : hovered && { backgroundColor: c.surfaceAlt }, pressed && { opacity: 0.8 }]}
    >
      {icon && <Ionicons name={icon} size={14} color={active ? c.onPrimary : col} />}
      <Text style={[s.chipText, { color: active ? c.onPrimary : c.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

/** options: [[key, label], ...] */
export function Segmented({ options, value, onChange }) {
  const s = useStyles();
  return (
    <View style={s.segment}>
      {options.map(([key, label]) => {
        const active = value === key;
        return (
          <Pressable key={key} onPress={() => onChange(key)} style={[s.segmentItem, active && s.segmentActive]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
            <Text style={[s.segmentText, active && s.segmentTextActive]} numberOfLines={1}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stat({ label, value, hint, color, icon, style }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={[s.stat, style]}>
      <View style={s.statLabelRow}>
        {icon && <Ionicons name={icon} size={13} color={c.muted} />}
        <Text style={s.statLabel} numberOfLines={2}>{label}</Text>
      </View>
      {/* Long values (e.g. "Unlimited", "$352.18 / $401.10") step down a size so narrow tiles don't truncate */}
      <Text style={[s.statValue, String(value).length > 8 && { fontSize: 15 }, String(value).length > 14 && { fontSize: 13 }, color && { color }]} numberOfLines={2} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Text style={s.statHint} numberOfLines={1}>{hint}</Text> : null}
    </View>
  );
}

export function Banner({ tone = "info", icon, children }) {
  const { c } = useTheme();
  const s = useStyles();
  const color = { info: c.primary, warn: c.warn, error: c.loss, success: c.gain }[tone];
  return (
    <View style={[s.banner, { backgroundColor: c.soft(color), borderColor: c.soft(color) }]}>
      <Ionicons name={icon ?? { info: "information-circle", warn: "warning", error: "alert-circle", success: "checkmark-circle" }[tone]} size={18} color={color} />
      <Text style={[s.bannerText, { color: c.text }]}>{children}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, text, action }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.empty}>
      <View style={[s.emptyIcon, { backgroundColor: c.primarySoft }]}>
        <Ionicons name={icon} size={26} color={c.primary} />
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      {text ? <Text style={s.emptyText}>{text}</Text> : null}
      {action ? <View style={{ marginTop: 14 }}>{action}</View> : null}
    </View>
  );
}

export function Input({ icon, right, style, inputStyle, ...props }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={[s.inputRow, style]}>
      {icon && <Ionicons name={icon} size={18} color={c.muted} />}
      <TextInput placeholderTextColor={c.muted} style={[s.input, inputStyle]} {...props} />
      {right}
    </View>
  );
}

export function Loading({ text }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.loading}>
      <ActivityIndicator color={c.primary} />
      {text ? <Text style={s.loadingText}>{text}</Text> : null}
    </View>
  );
}

export function Disclaimer({ children }) {
  const s = useStyles();
  return <Text style={s.disclaimer}>{children}</Text>;
}

const useStyles = makeStyles((c) => ({
  logoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoText: { color: c.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  card: { backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border },
  cardPad: { padding: 18 },
  section: { marginTop: 14 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  iconBadge: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  sectionTitle: { ...type.heading, color: c.text },
  sectionSubtitle: { color: c.muted, fontSize: 12, marginTop: 1 },
  pageHeader: { flexDirection: "row", alignItems: "flex-end", gap: 12, paddingTop: 8, paddingBottom: 14 },
  eyebrow: { ...type.caption, color: c.primary, marginBottom: 4 },
  pageTitle: { ...type.title, color: c.text },
  pageSubtitle: { color: c.textSecondary, fontSize: 15, marginTop: 4, lineHeight: 21 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 6, alignSelf: "flex-start" },
  backText: { color: c.primary, fontWeight: "600", fontSize: 16 },
  bulletRow: { flexDirection: "row", gap: 10, marginBottom: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  bulletText: { flex: 1, color: c.text, ...type.body },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, alignSelf: "flex-start", maxWidth: "100%" },
  pillText: { fontSize: 12, fontWeight: "700" },
  scoreRow: { flexDirection: "row", alignItems: "center", marginVertical: 5 },
  scoreLabel: { width: 112, color: c.textSecondary, fontSize: 14 },
  track: { flex: 1, height: 8, backgroundColor: c.surfaceAlt, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  scoreValue: { width: 44, textAlign: "right", fontWeight: "800" },
  button: { flexDirection: "row", gap: 8, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  buttonText: { fontWeight: "700", fontSize: 15 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: c.border, borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: 7 },
  chipText: { fontWeight: "600", fontSize: 13 },
  segment: { flexDirection: "row", backgroundColor: c.surfaceAlt, borderRadius: 12, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  segmentActive: { backgroundColor: c.surface, shadowColor: c.shadow, shadowOpacity: c.dark ? 0.4 : 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { color: c.muted, fontWeight: "600", fontSize: 13 },
  segmentTextActive: { color: c.text },
  stat: { flex: 1, backgroundColor: c.surfaceAlt, borderRadius: radius.md, padding: 12, minWidth: 0 },
  statLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statLabel: { color: c.muted, fontSize: 12, fontWeight: "500" },
  statValue: { color: c.text, fontSize: 18, fontWeight: "800", marginTop: 4, letterSpacing: -0.3, fontVariant: ["tabular-nums"] },
  statHint: { color: c.muted, fontSize: 11, marginTop: 2 },
  banner: { flexDirection: "row", gap: 10, borderRadius: radius.md, padding: 12, borderWidth: 1, marginTop: 12, alignItems: "flex-start" },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 19 },
  empty: { alignItems: "center", padding: 28, backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, marginTop: 14 },
  emptyIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptyTitle: { ...type.heading, color: c.text, marginTop: 12, textAlign: "center" },
  emptyText: { color: c.textSecondary, marginTop: 6, textAlign: "center", lineHeight: 20, maxWidth: 360 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, backgroundColor: c.surfaceAlt },
  input: { flex: 1, paddingVertical: 13, fontSize: 16, color: c.text, outlineStyle: "none" },
  loading: { flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center", paddingVertical: 24 },
  loadingText: { color: c.textSecondary, fontSize: 14, flexShrink: 1 },
  disclaimer: { color: c.muted, fontSize: 11, marginTop: 24, textAlign: "center", lineHeight: 16 },
}));
