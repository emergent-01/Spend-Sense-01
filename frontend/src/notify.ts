import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { api, type Alert } from "@/src/api";
import { storage } from "@/src/utils/storage";

const SEEN_KEY = "notified_alert_ids";
const isWeb = Platform.OS === "web";

if (!isWeb) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export type NotifPermission = "granted" | "denied" | "blocked" | "undetermined" | "unavailable";

export async function getNotifPermission(): Promise<NotifPermission> {
  if (isWeb) return "unavailable";
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return "granted";
  if (p.status === "undetermined") return "undetermined";
  return p.canAskAgain ? "denied" : "blocked";
}

export async function requestNotifPermission(): Promise<NotifPermission> {
  if (isWeb) return "unavailable";
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("spendsense_alerts", {
      name: "Budget alerts",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const p = await Notifications.requestPermissionsAsync();
  if (p.granted) return "granted";
  return p.canAskAgain ? "denied" : "blocked";
}

// Fetch alerts and show a phone notification for any not yet notified.
export async function syncAlertNotifications(): Promise<number> {
  const data = await api<{ items: Alert[]; unread: number }>("/alerts");
  if (isWeb) return data.unread;
  const perm = await Notifications.getPermissionsAsync();
  const seenRaw = (await storage.getItem<string>(SEEN_KEY, "[]")) as string;
  const seen: string[] = JSON.parse(seenRaw || "[]");
  const fresh = data.items.filter((a) => !a.read && !seen.includes(a.id));
  if (perm.granted) {
    for (const a of fresh.slice(0, 3)) {
      await Notifications.scheduleNotificationAsync({
        content: { title: a.title, body: a.message },
        trigger: Platform.OS === "android" ? { channelId: "spendsense_alerts" } : null,
      });
    }
  }
  if (fresh.length) await storage.setItem(SEEN_KEY, JSON.stringify([...seen, ...fresh.map((a) => a.id)].slice(-300)));
  return data.unread;
}
