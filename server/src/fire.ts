import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";

// The server is the only thing holding admin credentials. Without them it still runs
// rooms for guests; everything in here just answers "no".
export const live = !!process.env.FIREBASE_SERVICE_ACCOUNT;

if (live) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT!;
  const json = raw.trim().startsWith("{") ? raw : readFileSync(raw, "utf8");
  initializeApp({ credential: cert(JSON.parse(json)), databaseURL: process.env.FIREBASE_DATABASE_URL });
  // REST keeps the gRPC stack out of a 256mb machine
  getFirestore().settings({ preferRest: true });
}

export async function verify(idToken: string): Promise<string | null> {
  if (!live) return null;
  try {
    return (await getAuth().verifyIdToken(idToken)).uid;
  } catch {
    return null;
  }
}

export async function profile(uid: string) {
  const snap = await getFirestore().doc(`users/${uid}`).get();
  const d = snap.data() ?? {};
  return { username: (d.username as string | undefined) ?? null, tokens: (d.fcmTokens as string[] | undefined) ?? [] };
}

export async function areFriends(a: string, b: string) {
  const id = a < b ? `${a}_${b}` : `${b}_${a}`;
  return (await getFirestore().doc(`friendships/${id}`).get()).exists;
}

export async function isOnline(uid: string) {
  const snap = await getDatabase().ref(`status/${uid}/online`).get();
  return snap.val() === true;
}

export type InboxItem = { kind: "nudge" | "invite"; from: string; fromName: string; code?: string };

export async function inbox(uid: string, item: InboxItem) {
  await getFirestore().collection(`users/${uid}/inbox`).add({ ...item, at: FieldValue.serverTimestamp(), seen: false });
}

// one push per device token; a token the phone has since dropped gets forgotten
export async function push(uid: string, title: string, body: string, data: Record<string, string>) {
  const { tokens } = await profile(uid);
  if (!tokens.length) return 0;
  const r = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data,
    android: { priority: "high" },
  });
  const dead = tokens.filter((_, i) => r.responses[i].error?.code === "messaging/registration-token-not-registered");
  if (dead.length) await getFirestore().doc(`users/${uid}`).update({ fcmTokens: FieldValue.arrayRemove(...dead) });
  return r.successCount;
}

export async function recordMatch(m: {
  id: string;
  uids: [string, string];
  names: Record<string, string>;
  leaders: Record<string, string>;
  winner: string | null;
  reason: string;
  turns: number;
  startedAt: number;
}) {
  const db = getFirestore();
  const batch = db.batch();
  batch.set(db.doc(`matches/${m.id}`), { ...m, startedAt: new Date(m.startedAt), finishedAt: FieldValue.serverTimestamp() });
  for (const uid of m.uids) {
    if (!m.winner) continue;
    batch.update(db.doc(`users/${uid}`), uid === m.winner ? { wins: FieldValue.increment(1) } : { losses: FieldValue.increment(1) });
  }
  await batch.commit();
}
