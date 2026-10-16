import { allCards, getCard, validateDeckForFormat, ONE_PIECE_PRECONSTRUCTED_DECKS } from "@tcg/op-cards";
import type { OPCard } from "@tcg/op-types";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { cardImage } from "./cards";

export type Deck = {
  id: string;
  name: string;
  leader: string | null;
  cards: Record<string, number>;
  updated: number;
};

const KEY = "opsim.decks";

export function loadDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Deck[]) : [];
  } catch {
    return [];
  }
}

function store(decks: Deck[]) {
  localStorage.setItem(KEY, JSON.stringify(decks));
}

export function saveDeck(deck: Deck) {
  const decks = loadDecks().filter((d) => d.id !== deck.id);
  decks.unshift({ ...deck, updated: Date.now() });
  store(decks);
}

export function deleteDeck(id: string) {
  store(loadDecks().filter((d) => d.id !== id));
}

export function newDeck(): Deck {
  return { id: Math.random().toString(36).slice(2, 10), name: "New deck", leader: null, cards: {}, updated: Date.now() };
}

export function deckSize(deck: Deck) {
  return Object.values(deck.cards).reduce((a, b) => a + b, 0);
}

export function mainDeckList(deck: Deck): string[] {
  return Object.entries(deck.cards).flatMap(([id, n]) => Array(n).fill(id) as string[]);
}

// the engine owns the construction rules; we only turn its report into lines to show
export function deckProblems(deck: Deck): string[] {
  if (!deck.leader) return ["Pick a leader"];
  const entries = [{ cardId: deck.leader, quantity: 1 }, ...Object.entries(deck.cards).map(([cardId, quantity]) => ({ cardId, quantity }))];
  return validateDeckForFormat("standard", entries)
    .rules.filter((r) => !r.passed)
    .map((r) => r.message);
}

export const leaders: OPCard[] = allCards.filter((c) => c.cardType === "leader");
export const mainCards: OPCard[] = allCards.filter((c) => c.cardType !== "leader" && c.cardType !== "don");

export function colorsOf(c: OPCard) {
  return Array.isArray(c.color) ? c.color : [c.color];
}

export const preconDecks = ONE_PIECE_PRECONSTRUCTED_DECKS.map((d) => ({
  id: `pre:${d.code}`,
  label: `${d.code} ${d.name.replace(/^Starter Deck: /, "")}`,
  leader: d.leaderCardId,
  mainDeck: d.mainDeck.flatMap((e) => Array(e.quantity).fill(e.cardId) as string[]),
}));

// pulls every face in the deck through the service worker so it's there offline
export function prefetchImages(deck: Deck) {
  const ids = [deck.leader, ...Object.keys(deck.cards)].filter((x): x is string => !!x);
  for (const id of ids) fetch(cardImage(getCard(id).id), { mode: "no-cors" }).catch(() => {});
}

const ART_CACHE = "card-art-v1";

export function allArtUrls(): string[] {
  return allCards.filter((c) => c.cardType !== "don").map((c) => cardImage(c.id));
}

export async function cachedArtCount(): Promise<number> {
  if (!("caches" in window)) return 0;
  const keys = await (await caches.open(ART_CACHE)).keys();
  return keys.length;
}

// the art server throttles past roughly 20 requests a second and answers with error pages,
// so fetch natively where we can see the status and only cache real images
async function fetchArt(url: string, cache: Cache, signal: AbortSignal) {
  if (!Capacitor.isNativePlatform()) {
    await fetch(url, { mode: "no-cors", signal }).catch(() => {});
    return;
  }
  for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
    const r = await CapacitorHttp.get({ url, responseType: "blob" }).catch(() => null);
    if (r?.status === 200 && typeof r.data === "string" && r.data.length > 1000) {
      const blob = await (await fetch(`data:image/jpeg;base64,${r.data}`)).blob();
      await cache.put(url, new Response(blob, { headers: { "Content-Type": "image/jpeg" } }));
      return;
    }
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
}

export async function downloadArt(onProgress: (done: number, total: number) => void, signal: AbortSignal) {
  const cache = await caches.open(ART_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const todo = allArtUrls().filter((u) => !have.has(u));
  const total = allArtUrls().length;
  let done = total - todo.length;
  onProgress(done, total);
  let i = 0;
  const worker = async () => {
    while (i < todo.length && !signal.aborted) {
      await fetchArt(todo[i++], cache, signal);
      onProgress(++done, total);
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
}

// a face that fails to render was a throttled error page that got cached; drop it so the next look refetches
export function evictArt(url: string) {
  if ("caches" in window) caches.open(ART_CACHE).then((c) => c.delete(url)).catch(() => {});
}

// the plain list format other sims and deck sites use: one "4xOP10-111" per line,
// the leader in there as 1x like everything else
export function deckToText(deck: Deck): string {
  const lines = deck.leader ? [`1x${deck.leader}`] : [];
  for (const [id, n] of Object.entries(deck.cards)) lines.push(`${n}x${id}`);
  return lines.join("\n");
}

export function parseDeckText(text: string): { leader: string | null; cards: Record<string, number>; unknown: string[] } {
  let leader: string | null = null;
  const cards: Record<string, number> = {};
  const unknown: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^(\d+)\s*[x×]?\s*([A-Za-z0-9]+-\d+[A-Za-z0-9_]*)/);
    if (!m) continue;
    const n = Number(m[1]);
    const id = m[2].toUpperCase();
    let card;
    try {
      card = getCard(id);
    } catch {
      unknown.push(id);
      continue;
    }
    if (card.cardType === "leader") leader = card.id;
    else cards[card.id] = Math.min(4, (cards[card.id] ?? 0) + n);
  }
  return { leader, cards, unknown };
}
