import {
  applyCommand,
  commandFromDescriptor,
  getLegalCommands,
  heuristicAgent,
  resolveBotPromptCommand,
  type EngineCommand,
  type MatchSeat,
  type MatchState,
} from "@tcg/op-engine";
import { getCard } from "@tcg/op-cards";

export type Level = "normal" | "hard";

const rng = { random: Math.random };

function pending(state: MatchState) {
  return state.promptQueue.find((p) => p.status === "pending") ?? null;
}

// every concrete move open to the seat; an attack is one move per target
function moves(state: MatchState, seat: MatchSeat): EngineCommand[] {
  const out: EngineCommand[] = [];
  for (const d of getLegalCommands(state, seat)) {
    if (d.type === "declareAttack" && d.sourceId) {
      for (const targetId of d.targetIds ?? []) out.push({ type: "declareAttack", seat, attackerId: d.sourceId, targetId });
    } else {
      const c = commandFromDescriptor(state, seat, d);
      if (c) out.push(c);
    }
  }
  return out;
}

// Play the rest of the turn the normal bot's way and see where it lands. The other
// seat's prompts get the engine's default answer, which never blocks or counters: the
// bot can't see that hand, so it doesn't get to plan around it either.
function playOut(state: MatchState, seat: MatchSeat): MatchState {
  for (let i = 0; i < 60; i++) {
    if (state.status !== "active") break;
    const p = pending(state);
    let cmd: EngineCommand | null;
    if (p) cmd = p.kind === "judge" || p.seat !== seat ? resolveBotPromptCommand(state, p) : heuristicAgent.resolvePrompt?.(state, p, rng) ?? resolveBotPromptCommand(state, p);
    else if (state.activeSeat !== seat) break;
    else {
      const legal = getLegalCommands(state, seat);
      cmd = heuristicAgent.choose(state, seat, legal, rng) ?? (legal.some((c) => c.type === "endTurn") ? { type: "endTurn", seat } : null);
    }
    if (!cmd) break;
    const r = applyCommand(state, cmd);
    if (!r.accepted) break;
    state = r.state;
    if (cmd.type === "endTurn") break;
  }
  return state;
}

function power(state: MatchState, id: string) {
  const inst = state.cards[id];
  const card = getCard(inst.cardId);
  return ("power" in card && typeof card.power === "number" ? card.power : 0) + inst.attachedDon * 1000;
}

// what a position is worth to the seat, in roughly "thousands of power"
function worth(state: MatchState, seat: MatchSeat): number {
  if (state.status === "finished") return state.winner === seat ? 1e6 : -1e6;
  const other: MatchSeat = seat === "south" ? "north" : "south";
  const me = state.players[seat];
  const opp = state.players[other];
  const cost = (id: string) => {
    const c = getCard(state.cards[id].cardId);
    return "cost" in c && typeof c.cost === "number" ? c.cost : 0;
  };
  const board = (p: typeof me) => p.characterArea.reduce((n, id) => (id ? n + power(state, id) / 100 + cost(id) * 6 : n), 0);
  return (
    900 * (me.life.length - opp.life.length) +
    board(me) - board(opp) +
    22 * (me.hand.length - opp.hand.length) +
    2 * me.activeDon
  );
}

// Hard mode: try every move, follow each with the normal bot's play to the end of the
// turn, and keep the move whose turn ends best. One ply is enough to stop the bot
// wasting attacks on a 7000 wall or leaving lethal on the table.
export function hardChoice(state: MatchState, seat: MatchSeat): EngineCommand | null {
  const options = moves(state, seat);
  if (!options.length) return null;
  const usual = heuristicAgent.choose(state, seat, getLegalCommands(state, seat), rng);
  let best: EngineCommand | null = null;
  let bestWorth = -Infinity;
  for (const cmd of options) {
    const r = applyCommand(state, cmd);
    if (!r.accepted) continue;
    let w = worth(playOut(r.state, seat), seat);
    // on a tie keep the normal bot's instinct, it reads the board better than the score does
    if (usual && JSON.stringify(usual) === JSON.stringify(cmd)) w += 10;
    if (w > bestWorth) {
      bestWorth = w;
      best = cmd;
    }
  }
  return best;
}
