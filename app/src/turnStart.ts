import { useState } from "react";
import type { MatchState } from "@tcg/op-engine";
import { ME } from "./match";

// The engine runs refresh, draw and DON!! in one go and lands in main. On a real table
// you do those yourself, so the screen holds them back: the drawn card stays on the deck
// and the DON!! in the DON!! deck until they're taken. Nothing is sent to the engine for
// it; the real state is already there underneath.
interface Stage {
  turn: number;
  drawn: string[];
  don: number;
  drew: boolean;
  took: boolean;
  // how many log lines were there before this turn's refresh
  logsBefore: number;
}

function stageFor(was: MatchState, real: MatchState, cur: Stage | null): Stage | null {
  const mine = real.status === "active" && real.activeSeat === ME && real.phase === "main";
  if (!mine) return null;
  if (cur && cur.turn === real.turnNumber) return cur;
  // just reached main for this turn: whatever changed since the last state is the automatic part
  const fresh = !(was.activeSeat === ME && was.phase === "main" && was.turnNumber === real.turnNumber);
  if (!fresh) return null;
  const before = new Set(was.players[ME].hand);
  const drawn = real.players[ME].hand.filter((id) => !before.has(id) && was.cards[id]?.zone === "deck");
  const don = Math.max(0, Math.min(was.players[ME].donDeckCount - real.players[ME].donDeckCount, real.players[ME].activeDon));
  if (!drawn.length && !don) return null;
  return { turn: real.turnNumber, drawn, don, drew: !drawn.length, took: !don, logsBefore: was.logHistory.length };
}

function staged(real: MatchState, st: Stage): MatchState {
  const hide = st.drew ? [] : st.drawn;
  const back = st.took ? 0 : st.don;
  if (!hide.length && !back) return real;
  const p = real.players[ME];
  const cards = { ...real.cards };
  for (const id of hide) cards[id] = { ...cards[id], zone: "deck" };
  // the log already says what was drawn; show it only up to the phase we're pretending to be in
  const marker = hide.length ? "enters Draw." : "enters DON!! phase.";
  const at = real.logHistory.findIndex((l, i) => i >= st.logsBefore && l.message.endsWith(marker));
  return {
    ...real,
    phase: hide.length ? "draw" : "don",
    cards,
    logHistory: at >= 0 ? real.logHistory.slice(0, at + 1) : real.logHistory,
    players: {
      ...real.players,
      [ME]: {
        ...p,
        hand: p.hand.filter((id) => !hide.includes(id)),
        deck: [...hide, ...p.deck],
        donDeckCount: p.donDeckCount + back,
        activeDon: p.activeDon - back,
      },
    },
  };
}

export function useManualTurnStart(real: MatchState) {
  const [t, setT] = useState<{ real: MatchState; stage: Stage | null }>({ real, stage: null });
  let stage = t.stage;
  if (t.real !== real) {
    stage = stageFor(t.real, real, t.stage);
    setT({ real, stage });
  }
  const step = stage && !stage.drew ? "draw" : stage && !stage.took ? "don" : null;
  return {
    state: stage ? staged(real, stage) : real,
    step,
    donLeft: stage && !stage.took ? stage.don : 0,
    draw: () => setT((x) => (x.stage ? { ...x, stage: { ...x.stage, drew: true } } : x)),
    takeDon: () => setT((x) => (x.stage ? { ...x, stage: { ...x.stage, drew: true, took: true } } : x)),
  };
}
