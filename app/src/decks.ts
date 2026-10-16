import { allCards, getCard, validateDeckForFormat, ONE_PIECE_PRECONSTRUCTED_DECKS } from "@tcg/op-cards";
import type { OPCard } from "@tcg/op-types";
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
