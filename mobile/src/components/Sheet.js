import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme } from "../theme";

/** Modal sheet: slides up from the bottom on phones, a centered dialog on tablets and desktop. */
export default function Sheet({ visible, onClose, eyebrow, title, children, footer, maxWidth = 600 }) {
  const { c } = useTheme();
  const s = useStyles();
  const { width, height } = useWindowDimensions();
  const centered = width >= 768;
  return (
    <Modal supportedOrientations={["portrait", "landscape"]} visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[s.wrap, centered && { justifyContent: "center", padding: 24 }]}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[s.sheet, { maxWidth, maxHeight: height * (centered ? 0.88 : 0.92) }, centered && s.dialog]}>
          {!centered && <View style={s.handle} />}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
              {title ? <Text style={s.title}>{title}</Text> : null}
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8} style={s.close}>
              <Ionicons name="close" size={20} color={c.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay },
  sheet: { width: "100%", backgroundColor: c.elevated, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, paddingBottom: 30, borderWidth: 1, borderColor: c.border },
  dialog: { borderRadius: 24, paddingBottom: 22 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, alignSelf: "center", marginBottom: 14 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 8 },
  eyebrow: { color: c.primary, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  title: { fontSize: 21, fontWeight: "800", color: c.text, marginTop: 2 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" },
}));
