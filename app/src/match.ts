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

export const ME: MatchSeat = "south";
export const BOT: MatchSeat = "north";

export type DeckId = "st01" | TestDeckId;

export const DECKS: { id: DeckId; label: string }[] = [
  { id: "st01", label: "ST01 Straw Hat Crew" },
  { id: "red-aggro", label: "Red aggro (Zoro)" },
  { id: "blue-control", label: "Blue control" },
  { id: "green-midrange", label: "Green midrange" },
  { id: "purple-ramp", label: "Purple ramp" },
  { id: "black-removal", label: "Black removal" },
  { id: "yellow-trigger", label: "Yellow trigger" },
];

function playerConfig(deck: DeckId, playerName: string): MatchPlayerConfig {
  if (deck === "st01") return createSt01PlayerConfig(playerName);
  const d = TEST_DECKS[deck];
  return { leaderCardId: d.leaderId, mainDeck: [...d.mainDeck], donDeckCount: 10, playerName };
}

export function newMatch(mine: DeckId, theirs: DeckId, seed = Date.now()): MatchState {
  return createMatch({
    firstPlayer: ME,
    seed,
    shuffleDecks: true,
    skipFirstTurnDraw: true,
    players: { south: playerConfig(mine, "You"), north: playerConfig(theirs, "Bot") },
  });
}

export function pendingPrompt(state: MatchState) {
  return state.promptQueue.find((p) => p.status === "pending") ?? null;
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

export type TableEvent = { kind: "changed" } | { kind: "rejected"; reason: string };

export function localTable(initial: MatchState): Table {
  let state = initial;
  // DON attachments can be taken back until anything else happens, like asking
  // your opponent "wait, I meant the other one"
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
    if (cmd.type === "attachDon" && cmd.seat === ME) past.push(state);
    else past = [];
    commit(r.state);
  };

  const takeBack = () => {
    const s = past.pop();
    if (s) commit(s);
  };

  const commit = (s: MatchState) => {
    state = s;
    emit({ kind: "changed" });
    wakeBot();
  };

  const wakeBot = () => {
    clearTimeout(botTimer);
    const cmd = botCommand(state);
    if (!cmd) return;
    botTimer = setTimeout(() => send(cmd), state.status === "setup" ? 250 : 550);
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

function botCommand(state: MatchState): EngineCommand | null {
  const prompt = pendingPrompt(state);
  if (prompt) {
    if (prompt.seat === ME) return null;
    if (prompt.kind === "judge") return resolveBotPromptCommand(state, prompt);
    return heuristicAgent.resolvePrompt?.(state, prompt, rng) ?? resolveBotPromptCommand(state, prompt);
  }
  if (state.status === "setup") {
    const cmd = passOnlyStrategy(state, BOT, getLegalCommands(state, BOT));
    return cmd && setupTypes.has(cmd.type) ? cmd : null;
  }
  if (state.status === "active" && state.activeSeat === BOT) {
    const legal = getLegalCommands(state, BOT);
    const chosen = heuristicAgent.choose(state, BOT, legal, rng);
    if (chosen) return chosen;
    return legal.some((c) => c.type === "endTurn") ? { type: "endTurn", seat: BOT } : null;
  }
  return null;
}

export function useMatch(initial: MatchState) {
  // TODO: pick a remote table here once there's a server to talk to; the rest of
  // the hook and everything in App.tsx shouldn't need to know which it got
  const [table] = useState(() => localTable(initial));
  const [state, setState] = useState(table.state);
  const [undo, setUndo] = useState(() => table.undo ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = table.subscribe((ev) => {
      if (ev.kind === "rejected") {
        setError(ev.reason);
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

  return { state, send: table.send, error, undo };
}
