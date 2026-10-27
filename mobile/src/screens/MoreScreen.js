import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme } from "../theme";
import { PageHeader } from "../components/ui";

/** Phone-only menu for the sections that don't fit in the tab bar. */
export default function MoreScreen({ items, onSelect, unread }) {
  const { c, sections } = useTheme();
  const s = useStyles();
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <PageHeader eyebrow="More" title="Tools & account" />
      <View style={s.list}>
        {items.map((it, i) => {
          const sec = sections[it.section];
          return (
            <Pressable key={it.key} onPress={() => onSelect(it.key)} style={({ pressed }) => [s.row, i > 0 && s.divider, pressed && { backgroundColor: c.surfaceAlt }]} accessibilityRole="button">
              <View style={[s.icon, { backgroundColor: sec.soft }]}>
                <Ionicons name={it.icon ? `${it.icon}-outline` : sec.icon} size={19} color={sec.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{it.label}</Text>
                <Text style={s.sub}>{it.sub}</Text>
              </View>
              {it.key === "alerts" && unread > 0 && (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{unread > 9 ? "9+" : unread}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={c.muted} />
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  scroll: { padding: 16, paddingBottom: 60 },
  list: { backgroundColor: c.surface, borderRadius: 22, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  divider: { borderTopWidth: 1, borderTopColor: c.border },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  title: { color: c.text, fontWeight: "700", fontSize: 16 },
  sub: { color: c.muted, fontSize: 13, marginTop: 2 },
  badge: { backgroundColor: c.loss, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
}));
