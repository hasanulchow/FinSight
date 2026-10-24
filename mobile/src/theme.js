export const colors = {
  primary: "#4F46E5", // indigo
  primaryDark: "#3730A3",
  primarySoft: "#EEF2FF",
  bg: "#F5F7FF",
  card: "#FFFFFF",
  text: "#111827",
  muted: "#6B7280",
  border: "#E5E7EB",
  green: "#059669",
  greenSoft: "#D1FAE5",
  red: "#DC2626",
  redSoft: "#FEE2E2",
  amber: "#D97706",
  amberSoft: "#FEF3C7",
  white: "#FFFFFF",
};

// One color per briefing section so advisors can find things at a glance
export const sections = {
  summary: { color: "#4F46E5", soft: "#EEF2FF", icon: "sparkles-outline" },
  takeaways: { color: "#7C3AED", soft: "#F3E8FF", icon: "bulb-outline" },
  market: { color: "#0284C7", soft: "#E0F2FE", icon: "pulse-outline" },
  financials: { color: "#059669", soft: "#D1FAE5", icon: "bar-chart-outline" },
  business: { color: "#0D9488", soft: "#CCFBF1", icon: "briefcase-outline" },
  risks: { color: "#E11D48", soft: "#FFE4E6", icon: "warning-outline" },
  filings: { color: "#D97706", soft: "#FEF3C7", icon: "document-text-outline" },
  talking: { color: "#2563EB", soft: "#DBEAFE", icon: "chatbubbles-outline" },
  questions: { color: "#9333EA", soft: "#F3E8FF", icon: "help-circle-outline" },
  quality: { color: "#4F46E5", soft: "#EEF2FF", icon: "shield-checkmark-outline" },
};

export const riskColors = {
  market: "#0284C7",
  operational: "#D97706",
  financial: "#059669",
  regulatory: "#7C3AED",
  legal: "#9333EA",
  competitive: "#E11D48",
  macroeconomic: "#0D9488",
  technology: "#2563EB",
  other: "#6B7280",
};

// Stable, friendly color for a ticker avatar
const AVATAR_COLORS = ["#4F46E5", "#0284C7", "#059669", "#D97706", "#E11D48", "#7C3AED", "#0D9488", "#2563EB"];
export const tickerColor = (ticker = "") => AVATAR_COLORS[[...ticker].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];

export const scoreColor = (score) => (score >= 4 ? colors.green : score >= 3 ? colors.amber : colors.red);
export const scoreLabel = (score) => (score >= 4.5 ? "Excellent" : score >= 4 ? "Good" : score >= 3 ? "Fair" : "Needs review");

export const formatMoney = (value) => {
  if (value == null) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toFixed(2)}`;
};
