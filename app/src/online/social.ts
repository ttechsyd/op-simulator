import { useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { onValue, ref } from "firebase/database";
import { db, rtdb } from "./firebase";
import { idToken } from "./auth";
import { serverUrl } from "../net";

export type Friend = { uid: string; name: string; since: number };
export type Request = { id: string; from: string; to: string; fromName: string; toName: string };
export type Presence = { online: boolean; lastOnline: number };
export type InboxItem = { id: string; kind: "nudge" | "invite"; from: string; fromName: string; code?: string; at: number };

export const pairId = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);

export async function loadFriends(me: string): Promise<Friend[]> {
  const snap = await getDocs(query(collection(db, "friendships"), where("uids", "array-contains", me)));
  return snap.docs
    .map((d) => {
      const x = d.data();
      const uid = (x.uids as string[]).find((u) => u !== me)!;
      return { uid, name: (x.names as Record<string, string>)[uid] ?? "?", since: x.since?.toMillis?.() ?? 0 };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function findUser(username: string): Promise<{ uid: string; name: string } | null> {
  const lower = username.trim().toLowerCase();
  if (!lower) return null;
  const claim = await getDoc(doc(db, "usernames", lower));
  if (!claim.exists()) return null;
  const uid = claim.data().uid as string;
  const user = await getDoc(doc(db, "users", uid));
  return { uid, name: (user.data()?.username as string) ?? username };
}

export async function sendRequest(me: { uid: string; name: string }, to: { uid: string; name: string }) {
  const batch = writeBatch(db);
  batch.set(doc(db, "friendRequests", `${me.uid}_${to.uid}`), { from: me.uid, to: to.uid, fromName: me.name, toName: to.name, at: serverTimestamp() });
  await batch.commit();
}

// the one who says yes writes the friendship and clears the request together, which is
// what the rules check
export async function acceptRequest(r: Request) {
  const batch = writeBatch(db);
  batch.set(doc(db, "friendships", pairId(r.from, r.to)), {
    uids: [r.from, r.to].sort(),
    names: { [r.from]: r.fromName, [r.to]: r.toName },
    since: serverTimestamp(),
  });
  batch.delete(doc(db, "friendRequests", r.id));
  await batch.commit();
}

export const declineRequest = (r: Request) => deleteDoc(doc(db, "friendRequests", r.id));
export const removeFriend = (me: string, uid: string) => deleteDoc(doc(db, "friendships", pairId(me, uid)));

export function useRequests(me: string | null) {
  const [incoming, setIncoming] = useState<Request[]>([]);
  useEffect(() => {
    if (!me) return;
    return onSnapshot(query(collection(db, "friendRequests"), where("to", "==", me), orderBy("at", "desc")), (snap) =>
      setIncoming(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Request, "id">) }))),
    );
  }, [me]);
  return incoming;
}

// one realtime-database listener per friend; a few friends is a few open sockets' worth
export function usePresence(uids: string[]) {
  const [status, setStatus] = useState<Record<string, Presence>>({});
  const key = uids.join(",");
  useEffect(() => {
    const offs = uids.map((uid) =>
      onValue(ref(rtdb, `status/${uid}`), (snap) => {
        const v = snap.val() as Presence | null;
        setStatus((s) => ({ ...s, [uid]: v ?? { online: false, lastOnline: 0 } }));
      }),
    );
    return () => offs.forEach((off) => off());
  }, [key]);
  return status;
}

export function useInbox(me: string | null) {
  const [items, setItems] = useState<InboxItem[]>([]);
  useEffect(() => {
    if (!me) return;
    return onSnapshot(query(collection(db, `users/${me}/inbox`), where("seen", "==", false), orderBy("at", "desc")), (snap) =>
      setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InboxItem, "id" | "at">), at: d.data().at?.toMillis?.() ?? Date.now() }))),
    );
  }, [me]);
  const clear = (id: string) => updateDoc(doc(db, `users/${me}/inbox`, id), { seen: true });
  return { items, clear };
}

export function ago(t: number) {
  if (!t) return "a while ago";
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// the room server's http side lives next to its websocket
export async function api(path: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await idToken();
  if (!token) return { ok: false, error: "Sign in first" };
  const base = serverUrl().replace(/^ws/, "http");
  try {
    const r = await fetch(base + path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return { ok: true };
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: e.error ?? `Server said ${r.status}` };
  } catch {
    return { ok: false, error: `Can't reach ${base}` };
  }
}
