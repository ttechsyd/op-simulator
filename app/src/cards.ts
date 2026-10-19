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

// a skill that only hands out DON!! has nothing to do without one; which kind it wants
export function skillWantsDon(cardId: string): "rested" | "active" | null {
  const blocks = getCard(cardId).effects?.effects?.filter((e) => e.trigger === "activateMain") ?? [];
  const actions = blocks.flatMap((b) => b.actions ?? []);
  if (!actions.length || !actions.every((a) => a.action === "giveDon")) return null;
  return actions.some((a) => "donState" in a && a.donState === "rested") ? "rested" : "active";
}

const TIMINGS: Record<string, string> = {
  onPlay: "On Play",
  whenAttacking: "When Attacking",
  onBlock: "On Block",
  onKo: "On K.O.",
  activateMain: "Activate: Main",
  endOfYourTurn: "End of Your Turn",
  endOfOpponentTurn: "End of Your Opponent's Turn",
};

// the engine names timings by their camelCase key; the card prints them in brackets
export function timingName(trigger: string): string {
  return TIMINGS[trigger] ?? trigger.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

const CLAUSE = /\[(On Play|When Attacking|On Block|On K\.O\.|Activate: Main|Main|Counter|End of Your Turn|End of Your Opponent's Turn|On Your Opponent's Attack|Trigger)\]/g;

// the printed text of one timing on a card, so a prompt can say what it would do
export function effectFor(cardId: string, trigger: string): string {
  const c = getCard(cardId);
  if (trigger === "trigger") return "trigger" in c && typeof c.trigger === "string" ? c.trigger : "";
  const text = (c.effect ?? "").replace(/\s*This card has been officially errata'd\.?/, "");
  const at = text.indexOf(`[${timingName(trigger)}]`);
  if (at < 0) return "";
  let from = at + timingName(trigger).length + 2;
  // "[On Play]/[When Attacking] ..." shares one clause
  while (/^\/\[[^\]]+\]/.test(text.slice(from))) from = text.indexOf("]", from) + 1;
  CLAUSE.lastIndex = from;
  const next = CLAUSE.exec(text);
  let end = next ? next.index : text.length;
  // a "[DON!! x1]" condition in front of the next clause belongs to it
  const cond = text.slice(from, end).search(/\[DON!! x\d+\]\s*$/);
  if (cond >= 0) end = from + cond;
  return text.slice(from, end).replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}
