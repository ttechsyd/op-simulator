// bot-vs-bot fuzzing of the One Piece engine. Every precon and test deck plays every other
// deck (and itself) a few rounds with fixed seeds; anything the engine does that a player
// would report as a bug gets written to a JSON report. Run through fuzz.mjs.
import "@tcg/op-cards";
import { ONE_PIECE_PRECONSTRUCTED_DECKS } from "@tcg/op-cards";
import {
  applyCommand,
  createMatch,
  getLegalCommands,
  heuristicAgent,
  passOnlyStrategy,
  resolveBotPromptCommand,
  TEST_DECKS,
  type EngineCommand,
  type MatchPlayerConfig,
  type MatchSeat,
  type MatchState,
} from "@tcg/op-engine";
import fs from "node:fs";
import path from "node:path";

type Deck = { name: string; config: MatchPlayerConfig };

type FlagKind =
  | "rejected"
  | "stuck"
  | "turnCap"
  | "exception"
  | "capability"
  | "blankName"
  | "noTarget"
  | "oncePerTurn";

type Flag = {
  kind: FlagKind;
  seed: number;
  south: string;
  north: string;
  turn: number;
  cards: string[];
  detail: string;
  log: string[];
};

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const rounds = Number(opt("rounds", "6"));
const maxTurns = Number(opt("turns", "40"));
const baseSeed = Number(opt("seed", "1"));
const onlyPair = opt("pair", "");
const outFile = opt("out", "scripts/fuzz-report.json");
const dumpLogs = args.includes("--log");
const deckFiles = args.filter((a, i) => a.endsWith(".json") && args[i - 1] !== "--out");

const SEATS: MatchSeat[] = ["south", "north"];

function loadDeckFile(file: string): Deck {
  const d = JSON.parse(fs.readFileSync(file, "utf8")) as {
    name?: string;
    leader: string;
    cards: Record<string, number>;
  };
  const mainDeck = Object.entries(d.cards).flatMap(([id, n]) => Array<string>(n).fill(id));
  return { name: d.name ?? path.basename(file, ".json"), config: { leaderCardId: d.leader, mainDeck, donDeckCount: 10 } };
}

const decks: Deck[] = [
  ...ONE_PIECE_PRECONSTRUCTED_DECKS.map((d) => ({
    name: d.code,
    config: {
      leaderCardId: d.leaderCardId,
      mainDeck: d.mainDeck.flatMap((e) => Array<string>(e.quantity).fill(e.cardId)),
      donDeckCount: 10,
    },
  })),
  ...Object.entries(TEST_DECKS).map(([id, d]) => ({
    name: id,
    config: { leaderCardId: d.leaderId, mainDeck: [...d.mainDeck], donDeckCount: 10 },
  })),
  ...deckFiles.map(loadDeckFile),
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pending = (state: MatchState) => state.promptQueue.find((p) => p.status === "pending") ?? null;
const tail = (state: MatchState) => state.logHistory.slice(-15).map((l) => l.message);
const leaders = (state: MatchState) => SEATS.map((s) => state.cards[state.players[s].leaderInstanceId].cardId);

// card ids behind any instance id the command mentions, plus the prompt's source card
function cardsIn(state: MatchState, cmd: EngineCommand): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (typeof v === "string" && state.cards[v]) out.push(state.cards[v].cardId);
    else if (Array.isArray(v)) v.forEach(visit);
  };
  Object.values(cmd).forEach(visit);
  if (cmd.type === "resolvePrompt" || cmd.type === "judgeResolvePrompt") {
    const p = state.promptQueue.find((p) => p.id === cmd.promptId);
    if (p?.sourceCardId) out.push(p.sourceCardId);
  }
  return out.length ? out : leaders(state);
}

function nextCommand(state: MatchState, ctx: { random: () => number }): EngineCommand | null {
  const prompt = pending(state);
  if (prompt) {
    if (prompt.kind === "judge") return resolveBotPromptCommand(state, prompt);
    return heuristicAgent.resolvePrompt?.(state, prompt, ctx) ?? resolveBotPromptCommand(state, prompt);
  }
  if (state.status === "setup") {
    for (const seat of SEATS) {
      const cmd = passOnlyStrategy(state, seat, getLegalCommands(state, seat), ctx);
      if (cmd) return cmd;
    }
    return null;
  }
  const seat = state.activeSeat;
  const legal = getLegalCommands(state, seat);
  return (
    heuristicAgent.choose(state, seat, legal, ctx) ??
    (legal.some((c) => c.type === "endTurn") ? { type: "endTurn", seat } : null)
  );
}

// [Once Per Turn] keys still sitting on the non-turn player's cards once the refresh step is
// over were set last turn and should have been cleared. The engine only resets the turn
// player's cards, so we play each command a second time on a copy with those keys wiped and
// see whether anything different happens.
function staleKeys(state: MatchState): Map<string, string[]> {
  const stale = new Map<string, string[]>();
  for (const inst of Object.values(state.cards)) {
    if (inst.controller !== state.activeSeat && inst.usedEffectKeys.length) stale.set(inst.instanceId, [...inst.usedEffectKeys]);
  }
  return stale;
}

function summarize(state: MatchState, since: number): string[] {
  const lines = state.logHistory.slice(since).map((l) => l.message);
  const prompt = pending(state);
  if (prompt) lines.push(`[prompt ${prompt.kind}/${prompt.choiceKind ?? "-"} for ${prompt.seat}]`);
  return lines;
}

type GameResult = { flags: Flag[]; turns: number; finished: boolean; log: string[] };

function play(south: Deck, north: Deck, seed: number): GameResult {
  const flags: Flag[] = [];
  const ctx = { random: mulberry32(seed) };
  let state = createMatch({
    firstPlayer: "south",
    seed,
    shuffleDecks: true,
    skipFirstTurnDraw: true,
    players: {
      south: { ...south.config, playerName: south.name },
      north: { ...north.config, playerName: north.name },
    },
  });
  const flag = (kind: FlagKind, cards: (string | null)[], detail: string, at = state) =>
    flags.push({
      kind,
      seed,
      south: south.name,
      north: north.name,
      turn: at.turnNumber,
      cards: [...new Set(cards.filter((c): c is string => !!c))],
      detail,
      log: tail(at),
    });

  let seenLogs = state.logHistory.length;
  let seenIssues = state.capabilityHistory.length;
  let idle = 0;
  let stale = new Map<string, string[]>();
  let staleTurn = 0;

  for (let step = 0; step < 5000; step++) {
    if (state.status === "finished") break;
    if (state.turnNumber > maxTurns) {
      flag("turnCap", leaders(state), `still going after ${maxTurns} turns`);
      break;
    }

    const cmd = nextCommand(state, ctx);
    if (!cmd) {
      if (++idle > 3) {
        const p = pending(state);
        flag("stuck", p?.sourceCardId ? [p.sourceCardId] : leaders(state), p ? `nobody can answer ${p.kind}/${p.choiceKind ?? "-"} prompt for ${p.seat}` : `no legal command for ${state.activeSeat} in ${state.phase}`);
        break;
      }
      continue;
    }
    idle = 0;

    if (state.status === "active" && state.turnNumber !== staleTurn && state.phase !== "refresh") {
      staleTurn = state.turnNumber;
      stale = staleKeys(state);
    }
    let alt: MatchState | null = null;
    const wiped: string[] = [];
    if (stale.size) {
      for (const [id, keys] of stale) {
        const inst = state.cards[id];
        if (!inst || inst.controller === state.activeSeat || !keys.some((k) => inst.usedEffectKeys.includes(k))) continue;
        alt ??= structuredClone(state);
        alt.cards[id].usedEffectKeys = inst.usedEffectKeys.filter((k) => !keys.includes(k));
        wiped.push(id);
      }
    }

    let result;
    try {
      result = applyCommand(state, cmd);
    } catch (e) {
      const err = e as Error;
      flag("exception", cardsIn(state, cmd), `${cmd.type}: ${(err.stack ?? String(err)).split("\n").slice(0, 3).join(" | ")}`);
      break;
    }
    if (!result.accepted) {
      flag("rejected", cardsIn(state, cmd), `${cmd.type} rejected: ${result.reason}`);
      break;
    }

    if (alt) {
      try {
        const altResult = applyCommand(alt, cmd);
        const real = summarize(result.state, seenLogs);
        const counter = summarize(altResult.state, seenLogs);
        if (altResult.accepted && JSON.stringify(real) !== JSON.stringify(counter)) {
          const cards = wiped.map((id) => state.cards[id].cardId);
          flag(
            "oncePerTurn",
            cards,
            `${cards.join(", ")} kept ${wiped.map((id) => stale.get(id)!.join("/")).join("; ")} from last turn; with it cleared the engine would log: ${counter.filter((l) => !real.includes(l)).join(" | ")}`,
            result.state,
          );
          for (const id of wiped) stale.delete(id);
        }
      } catch {
        // the copy blowing up is not the bug we are after here
      }
    }

    state = result.state;

    for (const issue of state.capabilityHistory.slice(seenIssues)) {
      flag("capability", [issue.sourceCardId], `${issue.kind} ${issue.code}: ${issue.details}`);
    }
    seenIssues = state.capabilityHistory.length;

    const fresh = state.logHistory.slice(seenLogs);
    for (const [i, entry] of fresh.entries()) {
      const m = entry.message;
      const targets = entry.targetIds.map((id) => state.cards[id]?.cardId ?? null);
      if (/  |^ /.test(m)) flag("blankName", [entry.sourceCardId, ...targets], m);
      if (m.endsWith(" resolves without a target.")) {
        const name = m.slice(0, -" resolves without a target.".length);
        const at = seenLogs + i;
        const before = state.logHistory.slice(Math.max(0, at - 4), at);
        if (before.some((e) => e.message.startsWith(name) && /cost:|DON!!/.test(e.message))) {
          flag("noTarget", [entry.sourceCardId], `${before.map((e) => e.message).join(" | ")} | ${m}`);
        }
      }
    }
    seenLogs = state.logHistory.length;
  }

  return { flags, turns: state.turnNumber, finished: state.status === "finished", log: state.logHistory.map((l) => l.message) };
}

const pairs: [Deck, Deck][] = [];
if (onlyPair) {
  const [a, b] = onlyPair.split(",").map((n) => decks.find((d) => d.name === n));
  if (!a || !b) {
    console.error(`unknown deck in --pair; have: ${decks.map((d) => d.name).join(", ")}`);
    process.exit(2);
  }
  pairs.push([a, b]);
} else {
  for (let i = 0; i < decks.length; i++) for (let j = i; j < decks.length; j++) pairs.push([decks[i], decks[j]]);
}

const all: Flag[] = [];
let games = 0;
let finished = 0;
let turnsTotal = 0;
const started = Date.now();
for (const [pi, [a, b]] of pairs.entries()) {
  let pairFlags = 0;
  for (let r = 0; r < rounds; r++) {
    const seed = baseSeed * 10007 + pi * 101 + r;
    const [south, north] = r % 2 ? [b, a] : [a, b];
    const game = play(south, north, seed);
    games++;
    turnsTotal += game.turns;
    if (game.finished) finished++;
    all.push(...game.flags);
    pairFlags += game.flags.length;
    if (dumpLogs) console.log(`\n--- seed ${seed}: ${south.name} (south) vs ${north.name} (north)\n${game.log.join("\n")}`);
  }
  console.log(`${a.name} vs ${b.name}: ${rounds} games, ${pairFlags} flags`);
}

const unique = new Map<string, Flag & { count: number }>();
for (const f of all) {
  const key = `${f.kind}|${[...f.cards].sort().join(",")}${f.kind === "capability" ? `|${f.detail.split(":")[0]}` : ""}`;
  const seen = unique.get(key);
  if (seen) seen.count++;
  else unique.set(key, { ...f, count: 1 });
}

const kinds: FlagKind[] = ["exception", "rejected", "stuck", "turnCap", "capability", "oncePerTurn", "noTarget", "blankName"];
console.log(`\n${games} games, ${finished} finished, avg ${(turnsTotal / games).toFixed(1)} turns, ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`${"kind".padEnd(14)}${"total".padStart(7)}${"unique".padStart(8)}`);
for (const k of kinds) {
  const total = all.filter((f) => f.kind === k).length;
  const uniq = [...unique.values()].filter((f) => f.kind === k).length;
  if (total) console.log(`${k.padEnd(14)}${String(total).padStart(7)}${String(uniq).padStart(8)}`);
}

fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      ran: new Date().toISOString(),
      games,
      finished,
      decks: decks.map((d) => d.name),
      flags: [...unique.values()].sort((x, y) => kinds.indexOf(x.kind) - kinds.indexOf(y.kind) || y.count - x.count),
    },
    null,
    2,
  ),
);
console.log(`${unique.size} unique flags -> ${outFile}`);
