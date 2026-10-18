import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { arrayRemove, arrayUnion, doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

export type Intent = { kind: "nudge" | "invite" | "dm"; from: string; code?: string };

// a tapped notification that arrived before the app was ready to act on it
let pending: Intent | null = null;
let foreground: ((i: Intent & { title: string; body: string }) => void) | null = null;
let token: string | null = null;

const intentOf = (data: Record<string, string> | undefined): Intent | null =>
  data?.kind === "nudge" || data?.kind === "invite" || data?.kind === "dm" ? { kind: data.kind, from: data.from, code: data.code } : null;

// hooked up before React mounts so a cold start from a notification still lands somewhere
export function armPush() {
  if (!Capacitor.isNativePlatform()) return;
  PushNotifications.addListener("registration", (t) => (token = t.value));
  PushNotifications.addListener("pushNotificationActionPerformed", (e) => {
    pending = intentOf(e.notification.data);
  });
  PushNotifications.addListener("pushNotificationReceived", (n) => {
    const i = intentOf(n.data);
    if (i) foreground?.({ ...i, title: n.title ?? "", body: n.body ?? "" });
  });
}

export const takeIntent = () => {
  const i = pending;
  pending = null;
  return i;
};
export const onForeground = (cb: typeof foreground) => (foreground = cb);

// after sign-in: ask, register, and file the device token under the player
export async function registerPush(uid: string) {
  if (!Capacitor.isNativePlatform()) return;
  const p = await PushNotifications.requestPermissions();
  if (p.receive !== "granted") return;
  await PushNotifications.register();
  for (let i = 0; i < 20 && !token; i++) await new Promise((r) => setTimeout(r, 250));
  if (token) await updateDoc(doc(db, "users", uid), { fcmTokens: arrayUnion(token) });
}

export async function unregisterPush(uid: string) {
  if (token) await updateDoc(doc(db, "users", uid), { fcmTokens: arrayRemove(token) }).catch(() => {});
}
