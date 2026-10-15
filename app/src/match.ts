import { useCallback, useEffect, useState } from "react";
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

export function newMatch(mine: DeckId, theirs: DeckId): MatchState {
  return createMatch({
    firstPlayer: ME,
    seed: Date.now(),
    shuffleDecks: true,
    skipFirstTurnDraw: true,
    players: { south: playerConfig(mine, "You"), north: playerConfig(theirs, "Bot") },
  });
}

const rng = { random: Math.random };
const setupTypes = new Set(["chooseJoKenPo", "chooseFirstPlayer", "mulligan", "keepHand", "startGame"]);

export function pendingPrompt(state: MatchState) {
  return state.promptQueue.find((p) => p.status === "pending") ?? null;
}

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
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback((cmd: EngineCommand) => {
    setState((s) => {
      const r = applyCommand(s, cmd);
      if (!r.accepted) {
        setError(r.reason ?? "That move isn't allowed right now");
        return s;
      }
      return r.state;
    });
  }, []);

  useEffect(() => {
    const cmd = botCommand(state);
    if (!cmd) return;
    const wait = state.status === "setup" ? 250 : 550;
    const t = setTimeout(() => send(cmd), wait);
    return () => clearTimeout(t);
  }, [state, send]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2500);
    return () => clearTimeout(t);
  }, [error]);

  return { state, send, error };
}
