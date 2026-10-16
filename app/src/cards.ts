import { getCard } from "@tcg/op-cards";

const imageCache = new Map<string, string>();

const ART = "https://www.optcgapi.com/media/static/Card_Images/";

// The catalog points some cards at Bandai's own site, which won't serve images to a
// webview. The art server has those too under the plain id, except promos (and ST14-004),
// which only exist on Bandai's site and reach the table through the native download cache.
export function cardImage(cardId: string): string {
  let url = imageCache.get(cardId);
  if (!url) {
    const printed = getCard(cardId).printings[0]?.imageUrl;
    if (printed?.includes("optcgapi.com")) url = printed;
    else if (printed && (/^(P-|EVENT|PRB)/.test(cardId) || cardId === "ST14-004")) url = printed;
    else url = `${ART}${cardId}.jpg`;
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
