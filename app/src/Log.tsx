import { useEffect, useMemo, useRef } from "react";
import type { MatchState, ProjectedLogEntry } from "@tcg/op-engine";
import { cardCounter, cardName } from "./cards";
import { ME } from "./match";

const IRREGULAR: Record<string, string> = { is: "are", has: "have", does: "do", goes: "go" };
const owner = (name: string) => (name === "You" ? "Your" : `${name}'s`);

// Only what the player reads changes here. turnStart.ts, skips.ts and the helpers below
// match the engine's own sentences, so those stay as the engine wrote them.
const REWRITES: [RegExp, string | ((...m: string[]) => string)][] = [
  [/^(.+?) enters? (Refresh|Draw|DON!!|Main|End)(?: phase)?\.$/, (_, who, phase) => `${owner(who)} ${phase} Phase.`],
  [/ adds? (\d+) DON!! from the DON!! deck to the cost area active\.$/, (m, n) => `${m.startsWith(" adds") ? " adds" : " add"} ${n} DON!!.`],
  [/ adds? (\d+) DON!! from the DON!! deck to the cost area rested\.$/, (m, n) => `${m.startsWith(" adds") ? " adds" : " add"} ${n} rested DON!!.`],
  [/\battach(es)? (\d+) DON!!/, (_, es, n) => `give${es ? "s" : ""} ${n} DON!!`],
  [/^(.+?) cost: return (\d+) DON!! to your DON!! deck\.$/, (_, who, n) => `${who} ${who === "You" ? "pay" : "pays"} DON!! −${n}.`],
  [/^(.+?) cost: /, (_, who) => `${owner(who)} cost: `],
  [/(\d+) ([A-Za-z]+)\(s\)/g, (_, n, w) => `${n} ${w}${n === "1" ? "" : "s"}`],
  [/ draws? for turn: /, (m) => (m.startsWith(" draws") ? " draws " : " draw ")],
  [/^You revealed (.+) from Life for its \[Trigger\]\.$/, "You reveal $1 from your Life: [Trigger]."],
  [/^You placed (.+) from Life at the bottom of your deck\.$/, "You place $1 from your Life at the bottom of your deck."],
  [/^You took (.+) from Life to hand\.$/, "You add $1 from your Life to your hand."],
  [/^In the \w+ Jo Ken Po round it was a draw\. /, "Rock-Paper-Scissors is a draw. "],
  [/^In the \w+ Jo Ken Po round (.+?) won the Jo Ken Po and will decide who takes the first turn\. /, (_, who) => `${who} won Rock-Paper-Scissors and ${who === "You" ? "pick" : "picks"} who goes first. `],
  [/^(.+?) decided to take the first turn\.$/, (_, who) => `${who} ${who === "You" ? "go" : "goes"} first.`],
  [/^.+? decided that (.+?) will take the first turn\.$/, (_, who) => `${who} ${who === "You" ? "go" : "goes"} first.`],
  // the hand is on screen already; listing it made the longest line in the log
  [/^You accepted the mulligan and your new opening hand is: .*$/, "You mulligan and draw 5 new cards."],
  [/^Cards drawn: .*$/, "You draw your opening hand."],
  [/ accepted mulligan and redraws (\d+) cards\.$/, " mulligans and draws $1 new cards."],
  [/ to top of /, " to the top of "],
  [/\bYou's\b/g, "your"],
  [/^Leaders placed: You and /, "Leaders placed: you and "],
  [/^(You .+) and adds it /, "$1 and add it "],
  [/([^.])\.\.$/, "$1."],
];

// the engine writes "<name> plays"; when the name is "You" that reads wrong.
// `who` says whose line it is, so an attack can name both owners.
export function wording(message: string, who?: { mine: boolean; opp: string }) {
  let s = message.replace(/^You (\w+?)(?=[ .,])/, (_, verb: string) => {
    if (IRREGULAR[verb]) return `You ${IRREGULAR[verb]}`;
    if (/(sh|ch|ss|x|z)es$/.test(verb)) return `You ${verb.slice(0, -2)}`;
    if (/[^aeiou]ies$/.test(verb)) return `You ${verb.slice(0, -3)}y`;
    if (/[^s]s$/.test(verb)) return `You ${verb.slice(0, -1)}`;
    return `You ${verb}`;
  });
  for (const [re, to] of REWRITES) s = s.replace(re, to as string);
  if (s.startsWith("You ")) s = s.replace(/ their /g, " your ");
  const attack = who && /^(.+) attacks (.+)\.$/.exec(s);
  if (attack) s = who!.mine ? `Your ${attack[1]} attacks ${who!.opp}'s ${attack[2]}.` : `${who!.opp}'s ${attack[1]} attacks your ${attack[2]}.`;
  return s;
}

// prompt text the engine copies into the log, and plays it announces twice; never shown
export function noise(message: string) {
  return !message.trim() || / has an optional effect\.$|takes the Counter step|may block the attack\.$| reveals .* to (play|activate) it\.$| may activate .*\[Trigger\]|^Choose |  /.test(message);
}

// bookkeeping lines the corner strip skips so the moves stay visible
export function filler(message: string) {
  return / enters |adds \d+ DON!!|^Decks shuffled|^Setup finished|^Leaders placed|^The match begins|places \d+ Life cards|draws \d+ opening cards/.test(message);
}

// what the corner strip and the log pass to wording() for a line
export function whose(l: ProjectedLogEntry, opp: string) {
  return l.actor === ME ? { mine: true, opp } : l.actor === "south" || l.actor === "north" ? { mine: false, opp } : undefined;
}

// the log says who attacked whom; the battle event remembers the numbers
export function battleNumbers(state: MatchState) {
  const m = new Map<string, { attackPower: number; defensePower: number }>();
  for (const e of state.eventHistory)
    if (e.type === "battleResolved" && e.eventId)
      m.set(e.eventId, { attackPower: Number(e.payload.attackPower), defensePower: Number(e.payload.defensePower) });
  return m;
}

export function logDetail(l: ProjectedLogEntry, state: MatchState, battles: ReturnType<typeof battleNumbers>) {
  if (l.eventId && / attacks /.test(l.message)) {
    const b = battles.get(l.eventId);
    if (b) return `${b.attackPower} vs ${b.defensePower}`;
  }
  const countered = / counters with (.+)\.$/.exec(l.message);
  if (countered && (l.actor === "south" || l.actor === "north")) {
    // the entry doesn't carry the card ids, but the counters just landed in that player's trash
    const trash = state.players[l.actor].trash.map((id) => state.cards[id]);
    const sum = countered[1].split(", ").reduce((n, name) => {
      const c = trash.find((x) => cardName(x.cardId) === name);
      return n + (c ? (cardCounter(c.cardId) ?? 0) : 0);
    }, 0);
    if (sum) return `+${sum}`;
  }
  return null;
}

export function Log({
  logs,
  state,
  oppName,
  onCard,
  onClose,
}: {
  logs: ProjectedLogEntry[];
  state: MatchState;
  oppName: string;
  onCard: (cardId: string, instanceId: string | null) => void;
  onClose: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    body.current?.scrollTo(0, body.current.scrollHeight);
  }, [logs.length]);

  const battles = useMemo(() => battleNumbers(state), [state.eventHistory]);

  // phase lines carry no actor, but whoever enters Refresh owns the turn; the header says so
  // and the phase lines themselves are dropped
  const owners = new Map<number, string>();
  for (const l of logs) {
    const m = /^(.+?) enters Refresh\.$/.exec(l.message);
    if (m) owners.set(l.turn, m[1]);
  }
  const shown = logs.filter((l) => !noise(l.message) && !/ enters (Refresh|Draw|DON!! phase|Main|End)\.$/.test(l.message));

  let turn = -1;
  return (
    <div className="log">
      <div className="log-head">
        <b>Log</b>
        <button className="ghost small" onClick={onClose} aria-label="hide log">✕</button>
      </div>
      <div className="log-body" ref={body}>
        {shown.map((l) => {
          const mark = l.turn !== turn;
          turn = l.turn;
          const phase = filler(l.message);
          const extra = logDetail(l, state, battles);
          const side = l.actor === ME ? "me" : l.actor === "south" || l.actor === "north" ? "opp" : "";
          return (
            <div key={l.id}>
              {mark && (
                <span className="turn">
                  {owners.has(l.turn) ? `Turn ${l.turn} · ${owners.get(l.turn) === "You" ? "your turn" : `${owners.get(l.turn)}'s turn`}` : "Setup"}
                </span>
              )}
              <div
                className={`log-line ${side} ${phase ? "phase" : ""} ${l.sourceCardId ? "tap" : ""}`}
                onClick={l.sourceCardId ? () => onCard(l.sourceCardId!, l.sourceInstanceId) : undefined}
              >
                <span>
                  {wording(l.message, whose(l, oppName))}
                  {extra && <small> {extra}</small>}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
