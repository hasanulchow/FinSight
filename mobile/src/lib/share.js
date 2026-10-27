import { Platform, Share } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Opens the native share sheet (or Web Share / clipboard on the web). Returns "shared" | "copied" | "dismissed". */
export async function shareLink({ title, message, url }) {
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text: message, url });
        return "shared";
      } catch {
        return "dismissed";
      }
    }
    await navigator.clipboard?.writeText(url);
    return "copied";
  }
  const res = await Share.share({ title, message: `${message} ${url}`, url });
  return res.action === Share.dismissedAction ? "dismissed" : "shared";
}

// A referral code from a ?ref= link, kept until onboarding uses it
const REF_KEY = "finsight.ref";
export async function rememberRef() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (ref && /^[A-Z0-9]{4,16}$/i.test(ref)) await AsyncStorage.setItem(REF_KEY, ref.toUpperCase()).catch(() => {});
}
export const storedRef = () => AsyncStorage.getItem(REF_KEY).catch(() => null);
export const clearRef = () => AsyncStorage.removeItem(REF_KEY).catch(() => {});
