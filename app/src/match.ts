import { useEffect, useState } from "react";
import {
  applyCommand,
  createMatch,
  createSt01PlayerConfig,
  getLegalCommands,
  heuristicAgent,
  passOnlyStrategy,
  resolveBotPromptCommand,
  TEST_DECKS,
  type EngineCommand,
  type MatchPlayerConfig,
  type MatchSeat,
  type MatchState,
  type TestDeckId,
} from "@tcg/op-engine";

import { loadDecks, mainDeckList, preconDecks } from "./decks";
import { hardChoice, type Level } from "./bot";

// which seat the screen belongs to. Against the bot it's always south; playing both
// sides from one phone it follows whoever has to act, so everything that reads these
// sees the table from the right chair
export let ME: MatchSeat = "south";
export let BOT: MatchSeat = "north";
export function sitAt(seat: MatchSeat) {
  ME = seat;
  BOT = seat === "south" ? "north" : "south";
}

export type Mode = "bot" | "self" | "online";

// "saved:<id>" is one of the user's decks, "pre:<code>" an official starter, the rest are the engine's test decks
export type DeckId = string;

export const DECKS: { id: DeckId; label: string }[] = [
  ...preconDecks.map((d) => ({ id: d.id, label: d.label })),
  { id: "red-aggro", label: "Test: red aggro (Zoro)" },
  { id: "blue-control", label: "Test: blue control" },
  { id: "green-midrange", label: "Test: green midrange" },
  { id: "purple-ramp", label: "Test: purple ramp" },
  { id: "black-removal", label: "Test: black removal" },
  { id: "yellow-trigger", label: "Test: yellow trigger" },
];

export function playerConfig(deck: DeckId, playerName: string): MatchPlayerConfig {
  if (deck.startsWith("saved:")) {
    const d = loadDecks().find((x) => x.id === deck.slice(6));
    if (d?.leader) return { leaderCardId: d.leader, mainDeck: mainDeckList(d), donDeckCount: 10, playerName };
  }
  const pre = preconDecks.find((d) => d.id === deck);
  if (pre) return { leaderCardId: pre.leader, mainDeck: [...pre.mainDeck], donDeckCount: 10, playerName };
  const test = TEST_DECKS[deck as TestDeckId];
  if (test) return { leaderCardId: test.leaderId, mainDeck: [...test.mainDeck], donDeckCount: 10, playerName };
  return createSt01PlayerConfig(playerName);
}

export function newMatch(mine: DeckId, theirs: DeckId, mode: Mode, seed = Date.now()): MatchState {
  const names = mode === "self" ? ["Player 1", "Player 2"] : ["You", "Bot"];
  return createMatch({
    firstPlayer: "south",
    seed,
    shuffleDecks: true,
    skipFirstTurnDraw: true,
    players: { south: playerConfig(mine, names[0]), north: playerConfig(theirs, names[1]) },
  });
}

export function pendingPrompt(state: MatchState) {
  return state.promptQueue.find((p) => p.status === "pending") ?? null;
}

// playing both sides: the chair that has something to do right now
export function seatToShow(state: MatchState): MatchSeat {
  const prompt = pendingPrompt(state);
  if (prompt && prompt.seat !== "judge") return prompt.seat;
  if (state.status === "setup") {
    for (const s of ["south", "north"] as const) if (getLegalCommands(state, s).some((c) => setupTypes.has(c.type))) return s;
  }
  return state.activeSeat ?? "south";
}

// The table is the client's only view of the game: whatever sits on the other
// side of it (the local bot today, a server with a real opponent later) owns the
// opponent's seat and the authoritative state. The UI never sees past this.
export type Table = {
  readonly state: MatchState;
  send(cmd: EngineCommand): void;
  // only there while something can be taken back; a remote table won't offer it
  readonly undo?: () => void;
  subscribe(fn: (ev: TableEvent) => void): () => void;
  close(): void;
};

export type TableEvent =
  | { kind: "changed" }
  | { kind: "rejected"; reason: string }
  // only a remote table says anything about the wire
  | { kind: "link"; me: "connecting" | "online" | "reconnecting"; peer: boolean };

export function localTable(initial: MatchState, mode: Mode, level: Level = "normal"): Table {
  let state = initial;
  // your own moves can be taken back until the bot answers one, like asking across
  // the table "wait, I meant the other one"; the bot never argues
  let past: MatchState[] = [];
  const listeners = new Set<(ev: TableEvent) => void>();
  let botTimer: ReturnType<typeof setTimeout> | undefined;

  const emit = (ev: TableEvent) => listeners.forEach((fn) => fn(ev));

  const send = (cmd: EngineCommand) => {
    const r = applyCommand(state, cmd);
    if (!r.accepted) {
      emit({ kind: "rejected", reason: r.reason ?? "That move isn't allowed right now" });
      return;
    }
    const judge = cmd.type === "resolvePrompt" && pendingPrompt(state)?.kind === "judge";
    if (judge) {
      // the rules question isn't anyone's move
    } else if (mode === "self" || cmd.seat === ME) {
      past.push(state);
      if (past.length > 30) past.shift();
    } else past = [];
    commit(r.state);
  };

  const takeBack = () => {
    const s = past.pop();
    if (s) commit(s);
  };

  const commit = (s: MatchState) => {
    state = s;
    if (import.meta.env.DEV) (window as unknown as { opsim: unknown }).opsim = { state };
    emit({ kind: "changed" });
    wakeBot();
  };

  // the bot thinks inside the timer, so the screen gets to draw the last move first
  const wakeBot = () => {
    clearTimeout(botTimer);
    botTimer = setTimeout(() => {
      const cmd = botCommand(state, mode, level);
      if (cmd) send(cmd);
    }, state.status === "setup" ? 250 : 550);
  };

  wakeBot();

  return {
    get state() {
      return state;
    },
    get undo() {
      return past.length ? takeBack : undefined;
    },
    send,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      clearTimeout(botTimer);
      listeners.clear();
    },
  };
}

const rng = { random: Math.random };
const setupTypes = new Set(["chooseJoKenPo", "chooseFirstPlayer", "mulligan", "keepHand", "startGame"]);

function botCommand(state: MatchState, mode: Mode, level: Level): EngineCommand | null {
  const prompt = pendingPrompt(state);
  if (prompt) {
    // rules questions the engine asks of nobody in particular get answered either way
    if (prompt.kind === "judge") return resolveBotPromptCommand(state, prompt);
    if (mode === "self" || prompt.seat === ME) return null;
    return heuristicAgent.resolvePrompt?.(state, prompt, rng) ?? resolveBotPromptCommand(state, prompt);
  }
  if (mode === "self") return null;
  if (state.status === "setup") {
    const cmd = passOnlyStrategy(state, BOT, getLegalCommands(state, BOT));
    return cmd && setupTypes.has(cmd.type) ? cmd : null;
  }
  if (state.status === "active" && state.activeSeat === BOT) {
    const legal = getLegalCommands(state, BOT);
    const chosen = level === "hard" ? hardChoice(state, BOT) : heuristicAgent.choose(state, BOT, legal, rng);
    if (chosen) return chosen;
    return legal.some((c) => c.type === "endTurn") ? { type: "endTurn", seat: BOT } : null;
  }
  return null;
}

export function useMatch(table: Table) {
  const [state, setState] = useState(table.state);
  const [undo, setUndo] = useState(() => table.undo ?? null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ me: "connecting" | "online" | "reconnecting"; peer: boolean } | null>(null);

  useEffect(() => {
    const off = table.subscribe((ev) => {
      if (ev.kind === "rejected") {
        setError(ev.reason);
        return;
      }
      if (ev.kind === "link") {
        setLink({ me: ev.me, peer: ev.peer });
        return;
      }
      setState(table.state);
      setUndo(() => table.undo ?? null);
    });
    return () => {
      off();
      table.close();
    };
  }, [table]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2500);
    return () => clearTimeout(t);
  }, [error]);

  return { state, send: table.send, error, undo, link };
}
