import { createContext, useContext } from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { makeStyles, useTheme } from "../theme";
import { Banner, Button } from "./ui";

// App.js provides a function that opens the Account & plans screen, so any screen can offer an upgrade.
export const UpgradeContext = createContext(() => {});
export const useOpenAccount = () => useContext(UpgradeContext);

/** Shows an API error; plan-limit errors (402 + upgrade) get an upgrade prompt instead of a plain banner. */
export function ErrorNotice({ error }) {
  if (!error) return null;
  const err = typeof error === "string" ? { message: error } : error;
  if (err.upgrade) return <UpgradeCard text={err.message} />;
  return <Banner tone="error">{err.message}</Banner>;
}

export function UpgradeCard({ title = "You've hit a Free plan limit", text }) {
  const { c } = useTheme();
  const s = useStyles();
  const openAccount = useOpenAccount();
  return (
    <LinearGradient colors={[c.soft(c.brand[0]), c.soft(c.brand[1])]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.card}>
      <View style={s.row}>
        <View style={s.icon}>
          <Ionicons name="rocket" size={18} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{title}</Text>
          {text ? <Text style={s.text}>{text}</Text> : null}
        </View>
      </View>
      <Button title="See Pro" icon="sparkles" size="sm" onPress={openAccount} style={{ marginTop: 12, alignSelf: "flex-start" }} />
    </LinearGradient>
  );
}

const useStyles = makeStyles((c) => ({
  card: { borderRadius: 18, padding: 16, marginTop: 12, borderWidth: 1, borderColor: c.primarySoft },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  icon: { width: 34, height: 34, borderRadius: 11, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
  title: { color: c.text, fontWeight: "800", fontSize: 15 },
  text: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 3 },
}));
