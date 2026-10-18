import { useEffect, useState } from "react";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signOut as fbSignOut } from "firebase/auth";
import { doc, getDoc, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { onDisconnect, onValue, ref, serverTimestamp as rtdbNow, set } from "firebase/database";
import { auth, configured, db, rtdb } from "./firebase";

export type User = { uid: string; username: string | null; photo: string | null };

// Google sign-in goes through the native plugin: Google refuses OAuth inside a WebView,
// and on the web the plugin just opens the normal popup. The credential is then handed to
// the JS SDK so Firestore and the database see the same user.
export async function signIn() {
  const r = await FirebaseAuthentication.signInWithGoogle();
  const idToken = r.credential?.idToken;
  if (idToken) await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
}

export async function signOut() {
  await FirebaseAuthentication.signOut().catch(() => {});
  await fbSignOut(auth);
  localStorage.removeItem("opsim.name");
}

export const idToken = () => (configured && auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null));

// user is undefined while Firebase is still deciding, null when signed out; named() is
// how the username sheet tells the rest of the app the claim went through
export function useUser() {
  const [user, setUser] = useState<User | null | undefined>(configured ? undefined : null);
  useEffect(() => {
    if (!configured) return;
    return onAuthStateChanged(auth, async (u) => {
      if (!u) return setUser(null);
      const snap = await getDoc(doc(db, "users", u.uid));
      if (!snap.exists()) await setDoc(doc(db, "users", u.uid), { createdAt: serverTimestamp(), wins: 0, losses: 0, fcmTokens: [] });
      const username = (snap.data()?.username as string | undefined) ?? null;
      if (username) localStorage.setItem("opsim.name", username);
      setUser({ uid: u.uid, username, photo: u.photoURL });
    });
  }, []);
  const named = (username: string) => setUser((u) => (u ? { ...u, username } : u));
  return { user, named };
}

export const USERNAME = /^[a-z0-9_]{3,16}$/;

// the lowercase form is the unique key; the display form keeps the player's casing
export async function claimUsername(uid: string, name: string): Promise<"ok" | "taken" | "invalid"> {
  const lower = name.trim().toLowerCase();
  if (!USERNAME.test(lower)) return "invalid";
  try {
    await runTransaction(db, async (tx) => {
      const taken = await tx.get(doc(db, "usernames", lower));
      if (taken.exists()) throw new Error("taken");
      tx.set(doc(db, "usernames", lower), { uid });
      tx.update(doc(db, "users", uid), { username: name.trim(), usernameLower: lower });
    });
  } catch (e) {
    if ((e as Error).message === "taken") return "taken";
    throw e;
  }
  localStorage.setItem("opsim.name", name.trim());
  return "ok";
}

// status/{uid} in the realtime database: the server flips it to offline for us when the
// socket drops, which is what makes "last online" honest
export function startPresence(uid: string) {
  const me = ref(rtdb, `status/${uid}`);
  const off = onValue(ref(rtdb, ".info/connected"), (snap) => {
    if (!snap.val()) return;
    onDisconnect(me)
      .set({ online: false, lastOnline: rtdbNow() })
      .then(() => set(me, { online: true, lastOnline: rtdbNow() }));
  });
  return () => {
    off();
    set(me, { online: false, lastOnline: rtdbNow() }).catch(() => {});
  };
}
