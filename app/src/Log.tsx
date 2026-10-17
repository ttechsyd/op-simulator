import { useEffect, useMemo, useRef } from "react";
import type { MatchState, ProjectedLogEntry } from "@tcg/op-engine";
import { cardCounter, cardName } from "./cards";

const IRREGULAR: Record<string, string> = { is: "are", has: "have", does: "do", goes: "go" };

// the engine writes "<name> plays"; when the name is "You" that reads wrong
export function wording(message: string) {
  return message.replace(/^You (\w+?)(?=[ .,])/, (_, verb: string) => {
    if (IRREGULAR[verb]) return `You ${IRREGULAR[verb]}`;
    if (/(sh|ch|ss|x|z)es$/.test(verb)) return `You ${verb.slice(0, -2)}`;
    if (/[^aeiou]ies$/.test(verb)) return `You ${verb.slice(0, -3)}y`;
    if (/[^s]s$/.test(verb)) return `You ${verb.slice(0, -1)}`;
    return `You ${verb}`;
  });
}

// bookkeeping lines the corner strip skips so the moves stay visible
export function filler(message: string) {
  return / enters |adds \d+ DON!!| reveals .* to play it\.$|takes the Counter step|^Decks shuffled|^Setup finished|^Leaders placed/.test(message);
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
  onCard,
  onClose,
}: {
  logs: ProjectedLogEntry[];
  state: MatchState;
  onCard: (cardId: string, instanceId: string | null) => void;
  onClose: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    body.current?.scrollTo(0, body.current.scrollHeight);
  }, [logs.length]);

  const battles = useMemo(() => battleNumbers(state), [state.eventHistory]);

  let turn = -1;
  return (
    <div className="log">
      <div className="log-head">
        <b>Log</b>
        <button className="ghost small" onClick={onClose} aria-label="hide log">✕</button>
      </div>
      <div className="log-body" ref={body}>
        {logs.map((l) => {
          const mark = l.turn !== turn;
          turn = l.turn;
          const phase = filler(l.message);
          const extra = logDetail(l, state, battles);
          return (
            <div key={l.id}>
              {mark && <span className="turn">turn {l.turn}</span>}
              <div
                className={`log-line ${l.actor === "south" ? "me" : ""} ${phase ? "phase" : ""} ${l.sourceCardId ? "tap" : ""}`}
                onClick={l.sourceCardId ? () => onCard(l.sourceCardId!, l.sourceInstanceId) : undefined}
              >
                <span>
                  {wording(l.message)}
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
