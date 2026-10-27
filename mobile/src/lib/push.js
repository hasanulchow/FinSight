import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { api } from "./api";

// Push notifications for alerts and digests (iOS/Android builds).
// Needs an EAS project id (run `eas init`), a physical device, and a development or store build:
// Expo Go doesn't receive remote push notifications. On web this is a no-op; the in-app inbox still works.

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export async function registerForPush() {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.log("Push notifications disabled: no EAS projectId (run `eas init`).");
    return null;
  }
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("alerts", { name: "Alerts", importance: Notifications.AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return null;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerPush(token, Platform.OS);
    return token;
  } catch (err) {
    console.log("Push registration failed:", err.message);
    return null;
  }
}

/** Calls `onTicker(ticker)` when the user taps a notification that carries a ticker. Returns an unsubscribe function. */
export function onNotificationTap(onTicker) {
  if (Platform.OS === "web") return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const ticker = response.notification.request.content.data?.ticker;
    if (ticker) onTicker(ticker);
  });
  return () => sub.remove();
}
