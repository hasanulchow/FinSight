import { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { makeStyles, useTheme } from "../theme";

/** "Live" with a pulsing dot while prices stream; "Delayed" when showing the last quote. Hidden when streaming is off. */
export default function LiveBadge({ status, live = true }) {
  const { c } = useTheme();
  const s = useStyles();
  const pulse = useRef(new Animated.Value(1)).current;
  const on = status === "live" && live;

  useEffect(() => {
    if (!on) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [on, pulse]);

  if (status === "off" || status === "idle") return null;
  const color = on ? c.gain : c.muted;
  return (
    <View style={[s.badge, { backgroundColor: c.soft(color) }]}>
      <Animated.View style={[s.dot, { backgroundColor: color, opacity: on ? pulse : 1 }]} />
      <Text style={[s.text, { color }]}>{on ? "Live" : status === "connecting" ? "Connecting" : "Last price"}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  badge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },
}));
