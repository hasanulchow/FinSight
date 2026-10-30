import Svg, { Circle, Path, Rect } from "react-native-svg";

// FinSight navigation icons: one consistent family (24px grid, 1.8 stroke, round caps and joins).
// Active icons get a soft tinted fill on their main shape so the selected section reads at a glance.

const ICONS = {
  today: (fill) => (
    <>
      <Path d="M5 16.5a7 7 0 0 1 14 0" fill={fill} />
      <Path d="M5 16.5a7 7 0 0 1 14 0M2.5 19.5h19M12 4.5v2M4.6 8.6l1.4 1.4M19.4 8.6 18 10" />
    </>
  ),
  copilot: (fill) => (
    <>
      <Path d="M10.5 3.5 12.3 8.7a2 2 0 0 0 1.3 1.3l5.2 1.8-5.2 1.8a2 2 0 0 0-1.3 1.3L10.5 20l-1.8-5.2a2 2 0 0 0-1.3-1.3L2.2 11.8l5.2-1.8a2 2 0 0 0 1.3-1.3z" fill={fill} />
      <Path d="M18.5 2.5v4M16.5 4.5h4" />
    </>
  ),
  trade: (fill) => (
    <>
      <Rect x="4" y="8" width="5" height="9" rx="1.2" fill={fill} />
      <Rect x="15" y="5" width="5" height="9" rx="1.2" fill={fill} />
      <Path d="M6.5 4.5V8M6.5 17v3M17.5 2.5V5M17.5 14v4.5" />
    </>
  ),
  portfolio: (fill) => (
    <>
      <Path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z" fill={fill} />
      <Path d="M15 2.9A8.5 8.5 0 0 1 21.1 9H15z" />
    </>
  ),
  research: (fill) => (
    <>
      <Circle cx="10.5" cy="10.5" r="6.5" fill={fill} />
      <Path d="m15.5 15.5 5 5M7.8 12.5l1.8-2 1.6 1.2 2.1-2.7" />
    </>
  ),
  markets: (fill) => (
    <>
      <Circle cx="12" cy="12" r="8.5" fill={fill} />
      <Path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z" />
    </>
  ),
  journal: (fill) => (
    <>
      <Path d="M6.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z" fill={fill} />
      <Path d="M9 3.5v17M12 8h4M12 11.5h4" />
    </>
  ),
  screener: (fill) => (
    <>
      <Path d="M3.5 5h17l-6.5 7.5v5.5l-4 2v-7.5z" fill={fill} />
    </>
  ),
  alerts: (fill) => (
    <>
      <Path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" fill={fill} />
      <Path d="M10 21h4" />
    </>
  ),
  tax: (fill) => (
    <>
      <Path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" fill={fill} />
      <Path d="m9.5 13.5 5-5M9.8 9.2h.01M14.2 12.8h.01" />
    </>
  ),
  account: (fill) => (
    <>
      <Circle cx="12" cy="12" r="8.5" fill={fill} />
      <Circle cx="12" cy="10" r="3" />
      <Path d="M6.8 18.4a6 6 0 0 1 10.4 0" />
    </>
  ),
  admin: (fill) => (
    <>
      <Rect x="4" y="12" width="4" height="8" rx="1" fill={fill} />
      <Rect x="10" y="8" width="4" height="12" rx="1" fill={fill} />
      <Rect x="16" y="4" width="4" height="16" rx="1" fill={fill} />
    </>
  ),
  more: (fill) => (
    <>
      <Rect x="3.5" y="3.5" width="7" height="7" rx="2" fill={fill} />
      <Rect x="13.5" y="3.5" width="7" height="7" rx="2" fill={fill} />
      <Rect x="3.5" y="13.5" width="7" height="7" rx="2" fill={fill} />
      <Rect x="13.5" y="13.5" width="7" height="7" rx="2" fill={fill} />
    </>
  ),
};

export const hasNavIcon = (name) => name in ICONS;

export default function NavIcon({ name, size = 22, color, active = false }) {
  const draw = ICONS[name] ?? ICONS.more;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" fillOpacity={0.2} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {draw(active ? color : "none")}
    </Svg>
  );
}
