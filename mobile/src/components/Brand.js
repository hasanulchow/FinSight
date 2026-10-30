import { Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { useTheme, font } from "../theme";

// FinSight identity. The mark is a lens (the "sight") with a trend line rising inside it and breaking out,
// ending in a bright spark: insight into where things are going. Built from simple geometry so it reads
// at 16px (favicon) and at 1024px (app icon). Keep in sync with assets/brand/mark.svg.

export const BRAND = {
  indigo: "#4F46E5",
  violet: "#7C3AED",
  cyan: "#22D3EE",
  ink: "#0B1020",
};

let gid = 0;

/** The app-icon style mark: gradient tile with the lens and trend line. */
export function LogoMark({ size = 36, rounded = true }) {
  const id = `fs${(gid = (gid + 1) % 100000)}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityRole="image" accessibilityLabel="FinSight">
      <Defs>
        <SvgGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#5B5BF7" />
          <Stop offset="0.55" stopColor={BRAND.violet} />
          <Stop offset="1" stopColor="#4C1D95" />
        </SvgGradient>
        <RadialGradient id={`${id}hl`} cx="0.22" cy="0.12" r="0.75">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.32" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="64" height="64" rx={rounded ? 17 : 0} fill={`url(#${id}bg)`} />
      <Rect x="0" y="0" width="64" height="64" rx={rounded ? 17 : 0} fill={`url(#${id}hl)`} />
      <Circle cx="27" cy="35" r="14" stroke="#FFFFFF" strokeWidth="4.8" fill="none" />
      <Path d="M18 40 L24 33.5 L29.5 37.5 L46 20" stroke="#FFFFFF" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx="48.5" cy="17.5" r="4.8" fill={BRAND.cyan} />
    </Svg>
  );
}

/** Mark without the tile (for use on brand-colored backgrounds). */
export function LogoGlyph({ size = 36, color = "#FFFFFF", accent = BRAND.cyan }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Circle cx="27" cy="35" r="14" stroke={color} strokeWidth="4.8" fill="none" />
      <Path d="M18 40 L24 33.5 L29.5 37.5 L46 20" stroke={color} strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx="48.5" cy="17.5" r="4.8" fill={accent} />
    </Svg>
  );
}

/** Mark + wordmark. `tone="light"` forces white text (on gradients). */
export function Logo({ size = 36, withName = true, nameSize, tone }) {
  const { c } = useTheme();
  const fontSize = nameSize ?? Math.round(size * 0.58);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: Math.round(size * 0.3) }}>
      <LogoMark size={size} />
      {withName && (
        <Text style={{ fontWeight: "800", fontFamily: font("800"), fontSize, letterSpacing: -fontSize * 0.04, color: tone === "light" ? "#FFFFFF" : c.text }}>
          Fin<Text style={{ color: tone === "light" ? "#C7D2FE" : c.primary }}>Sight</Text>
        </Text>
      )}
    </View>
  );
}
