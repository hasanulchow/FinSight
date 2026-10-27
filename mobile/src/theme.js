import { createContext, createElement, useContext, useMemo } from "react";
import { StyleSheet, useColorScheme } from "react-native";

// FinSight design system: light and dark palettes that follow the device setting.
// Components read the active palette with useTheme() and build styles with makeStyles().

/** Hex color with alpha, e.g. alpha("#4F46E5", 0.12). */
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Accent hues: light mode uses the 600 shade, dark mode the 400 shade, so contrast holds on both
const HUES = {
  indigo: ["#4F46E5", "#818CF8"],
  violet: ["#7C3AED", "#A78BFA"],
  sky: ["#0284C7", "#38BDF8"],
  emerald: ["#059669", "#34D399"],
  teal: ["#0D9488", "#2DD4BF"],
  rose: ["#E11D48", "#FB7185"],
  amber: ["#D97706", "#FBBF24"],
  blue: ["#2563EB", "#60A5FA"],
  fuchsia: ["#C026D3", "#E879F9"],
  cyan: ["#0891B2", "#22D3EE"],
  orange: ["#EA580C", "#FB923C"],
  pink: ["#DB2777", "#F472B6"],
};

function buildPalette(dark) {
  const hue = (name) => HUES[name][dark ? 1 : 0];
  const soft = (hex) => alpha(hex, dark ? 0.16 : 0.1);
  const base = dark
    ? {
        bg: "#06080F",
        surface: "#0D111C",
        surfaceAlt: "#141A28",
        elevated: "#181F30",
        border: "#1E2638",
        borderStrong: "#2B354C",
        text: "#F2F4FA",
        textSecondary: "#B0B9CD",
        muted: "#6F7A94",
        primary: "#7C83FF",
        onPrimary: "#FFFFFF",
        gain: "#34D399",
        loss: "#FB7185",
        warn: "#FBBF24",
        info: "#60A5FA",
        overlay: "rgba(0, 0, 0, 0.6)",
        shadow: "#000000",
      }
    : {
        bg: "#F5F6FA",
        surface: "#FFFFFF",
        surfaceAlt: "#F0F2F7",
        elevated: "#FFFFFF",
        border: "#E4E7EF",
        borderStrong: "#CED3DF",
        text: "#0A0F1E",
        textSecondary: "#4A5368",
        muted: "#7D869B",
        primary: "#4F46E5",
        onPrimary: "#FFFFFF",
        gain: "#059669",
        loss: "#DC2626",
        warn: "#D97706",
        info: "#2563EB",
        overlay: "rgba(10, 15, 30, 0.45)",
        shadow: "#1E1B4B",
      };
  return {
    dark,
    ...base,
    primarySoft: soft(base.primary),
    gainSoft: soft(base.gain),
    lossSoft: soft(base.loss),
    warnSoft: soft(base.warn),
    infoSoft: soft(base.info),
    hue,
    soft,
    // Brand gradient (logo, hero, primary moments)
    brand: dark ? ["#6366F1", "#8B5CF6", "#22D3EE"] : ["#4F46E5", "#7C3AED", "#0891B2"],
    // Legacy names kept for older call sites
    card: base.surface,
    green: base.gain,
    red: base.loss,
    amber: base.warn,
    greenSoft: soft(base.gain),
    redSoft: soft(base.loss),
    amberSoft: soft(base.warn),
    primaryDark: dark ? "#C7CBFF" : "#3730A3",
    white: "#FFFFFF",
  };
}

const PALETTES = { light: buildPalette(false), dark: buildPalette(true) };

/** One color + icon per briefing section, so the same information is always the same color. */
function buildSections(c) {
  const s = (hueName, icon) => ({ color: c.hue(hueName), soft: c.soft(c.hue(hueName)), icon });
  return {
    summary: s("indigo", "sparkles-outline"),
    takeaways: s("violet", "bulb-outline"),
    market: s("sky", "pulse-outline"),
    financials: s("emerald", "bar-chart-outline"),
    business: s("teal", "briefcase-outline"),
    risks: s("rose", "warning-outline"),
    filings: s("amber", "document-text-outline"),
    talking: s("blue", "chatbubbles-outline"),
    questions: s("fuchsia", "help-circle-outline"),
    quality: s("indigo", "shield-checkmark-outline"),
    technicals: s("sky", "analytics-outline"),
    events: s("pink", "calendar-outline"),
    ask: s("indigo", "chatbubble-ellipses-outline"),
    changes: s("cyan", "git-compare-outline"),
    options: s("cyan", "options-outline"),
    backtest: s("orange", "flask-outline"),
    markets: s("blue", "globe-outline"),
    portfolio: s("violet", "pie-chart-outline"),
    screener: s("teal", "funnel-outline"),
    alerts: s("amber", "notifications-outline"),
  };
}

const RISK_HUES = { market: "sky", operational: "amber", financial: "emerald", regulatory: "violet", legal: "fuchsia", competitive: "rose", macroeconomic: "teal", technology: "blue", other: null };

const ThemeContext = createContext(null);

/** Provides the palette for the device's light/dark setting. `scheme` can force one (used by previews). */
export function ThemeProvider({ children, scheme }) {
  const system = useColorScheme();
  const mode = scheme ?? (system === "dark" ? "dark" : "light");
  const theme = useMemo(() => {
    const c = PALETTES[mode];
    return {
      mode,
      c,
      sections: buildSections(c),
      riskColor: (category) => (RISK_HUES[category] ? c.hue(RISK_HUES[category]) : c.muted),
      tickerColor: (ticker = "") => {
        const names = ["indigo", "sky", "emerald", "amber", "rose", "violet", "teal", "blue"];
        return c.hue(names[[...ticker].reduce((s, ch) => s + ch.charCodeAt(0), 0) % names.length]);
      },
      scoreColor: (score) => (score >= 4 ? c.gain : score >= 3 ? c.warn : c.loss),
    };
  }, [mode]);
  return createElement(ThemeContext.Provider, { value: theme }, children);
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used inside <ThemeProvider>");
  return theme;
}

/** makeStyles((c, theme) => ({...})) returns a hook that gives StyleSheet styles for the active theme. */
export function makeStyles(factory) {
  const cache = new Map();
  return function useStyles() {
    const theme = useTheme();
    if (!cache.has(theme.mode)) cache.set(theme.mode, StyleSheet.create(factory(theme.c, theme)));
    return cache.get(theme.mode);
  };
}

// ---------- Shared tokens ----------
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const type = {
  display: { fontSize: 34, fontWeight: "800", letterSpacing: -0.8 },
  title: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  heading: { fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  mono: { fontVariant: ["tabular-nums"] },
};

// ---------- Formatting ----------
export const scoreLabel = (score) => (score >= 4.5 ? "Excellent" : score >= 4 ? "Good" : score >= 3 ? "Fair" : "Needs review");

export const formatMoney = (value) => {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
};

export const formatPct = (v, digits = 2) => (v == null || !Number.isFinite(Number(v)) ? "–" : `${v > 0 ? "+" : ""}${Number(v).toFixed(digits)}%`);
