import { getCard } from "@tcg/op-cards";

const imageCache = new Map<string, string>();

export function cardImage(cardId: string): string {
  let url = imageCache.get(cardId);
  if (!url) {
    url =
      getCard(cardId).printings[0]?.imageUrl ??
      `https://www.optcgapi.com/media/static/Card_Images/${cardId}.jpg`;
    imageCache.set(cardId, url);
  }
  return url;
}

export function cardName(cardId: string): string {
  return getCard(cardId).name;
}

export function cardText(cardId: string): string {
  const c = getCard(cardId);
  return c.effect ?? "";
}

export function cardCounter(cardId: string): number | null {
  const c = getCard(cardId);
  return "counter" in c && typeof c.counter === "number" ? c.counter : null;
}
