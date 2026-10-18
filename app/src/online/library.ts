import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getCard } from "@tcg/op-cards";
import { colorsOf, deckSize, newDeck, saveDeck, type Deck } from "../decks";
import { db } from "./firebase";

export type Shared = {
  id: string;
  name: string;
  leader: string;
  colors: string[];
  cards: Record<string, number>;
  author: string;
  authorName: string;
  likes: number;
  copies: number;
  createdAt: number;
};

export async function shareDeck(me: { uid: string; name: string }, deck: Deck) {
  const leader = getCard(deck.leader!);
  await addDoc(collection(db, "decks"), {
    name: deck.name,
    nameLower: deck.name.toLowerCase(),
    leader: deck.leader,
    colors: colorsOf(leader),
    cards: deck.cards,
    count: deckSize(deck),
    author: me.uid,
    authorName: me.name,
    createdAt: serverTimestamp(),
    likes: 0,
    copies: 0,
  });
}

const read = (d: QueryDocumentSnapshot): Shared => {
  const x = d.data();
  return { id: d.id, ...(x as Omit<Shared, "id" | "createdAt">), createdAt: x.createdAt?.toMillis?.() ?? 0 };
};

// newest first, or a name prefix; both can be narrowed to one leader
export async function browse(opts: { leader?: string; q?: string; after?: QueryDocumentSnapshot | null }) {
  const parts = [];
  if (opts.leader) parts.push(where("leader", "==", opts.leader));
  const q = opts.q?.trim().toLowerCase();
  if (q) parts.push(where("nameLower", ">=", q), where("nameLower", "<", q + ""), orderBy("nameLower"));
  else parts.push(orderBy("createdAt", "desc"));
  if (opts.after) parts.push(startAfter(opts.after));
  const snap = await getDocs(query(collection(db, "decks"), ...parts, limit(20)));
  return { decks: snap.docs.map(read), last: snap.docs[snap.docs.length - 1] ?? null };
}

export async function copyToMine(d: Shared) {
  saveDeck({ ...newDeck(), name: d.name, leader: d.leader, cards: { ...d.cards } });
  await updateDoc(doc(db, "decks", d.id), { copies: increment(1) }).catch(() => {});
}

export async function toggleLike(uid: string, d: Shared): Promise<boolean> {
  const mine = doc(db, "decks", d.id, "likes", uid);
  const liked = (await getDoc(mine)).exists();
  if (liked) {
    await deleteDoc(mine);
    await updateDoc(doc(db, "decks", d.id), { likes: increment(-1) });
  } else {
    await setDoc(mine, { at: serverTimestamp() });
    await updateDoc(doc(db, "decks", d.id), { likes: increment(1) });
  }
  return !liked;
}

export const unshare = (id: string) => deleteDoc(doc(db, "decks", id));
