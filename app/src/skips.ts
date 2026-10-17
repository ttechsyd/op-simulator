import { applyCommand, resolveBotPromptCommand, type MatchSeat, type MatchState, type PromptState } from "@tcg/op-engine";
import { getCard } from "@tcg/op-cards";
import { cardName } from "./cards";

// The engine drops an [End of Your Turn] effect without a word when its cost can't be paid
// (Kid's leader with the top Life card already face up) or its condition isn't met. Find the
// ones that went quiet in that turn's end phase so the screen can say so.
export function quietEndEffects(state: MatchState, seat: MatchSeat, turn: number): string[] {
  const p = state.players[seat];
  const heard = new Set<string>();
  for (const e of state.eventHistory)
    if (e.turn === turn && e.phase === "end" && e.sourceInstanceId && (e.type === "effectResolved" || e.type === "promptCreated")) heard.add(e.sourceInstanceId);
  for (const l of state.logHistory) if (l.turn === turn && l.phase === "end" && l.sourceInstanceId) heard.add(l.sourceInstanceId);

  const out: string[] = [];
  for (const id of [p.leaderInstanceId, ...p.characterArea, p.stageArea]) {
    if (!id || heard.has(id)) continue;
    const blocks = getCard(state.cards[id].cardId).effects?.effects?.filter((b) => b.trigger === "endOfYourTurn") ?? [];
    if (!blocks.length) continue;
    const why = blocks.some((b) => b.costs?.length) ? "can't pay its cost" : "condition not met";
    out.push(`${cardName(state.cards[id].cardId)} · [End of Your Turn] skipped, ${why}`);
  }
  return out;
}

// Would saying yes to this optional effect pay its cost and then hit nothing? Play it out
// on a copy: answer yes, let the follow-up questions take their default, and see whether
// it ends in "resolves without a target" having done nothing else.
export function wastedUse(state: MatchState, prompt: PromptState): boolean {
  if (prompt.resolutionContext?.intent !== "effectOptional") return false;
  const yes = prompt.options.find((o) => o.id === "yes");
  if (!yes) return false;
  const from = state.logHistory.length;
  let r = applyCommand(state, { type: "resolvePrompt", seat: prompt.seat as MatchSeat, promptId: prompt.id, optionId: yes.id });
  for (let i = 0; i < 8 && r.accepted; i++) {
    const next = r.state.promptQueue.find((x) => x.status === "pending");
    if (!next || next.seat !== prompt.seat || next.sourceInstanceId !== prompt.sourceInstanceId) break;
    // a real choice of target means there is something to hit
    if ((next.choiceKind === "selectTargets" || next.choiceKind === "selectCards") && next.options.some((o) => o.enabled !== false && o.targetId)) return false;
    const cmd = resolveBotPromptCommand(r.state, next);
    if (!cmd) break;
    r = applyCommand(r.state, cmd);
  }
  if (!r.accepted) return false;
  const log = r.state.logHistory.slice(from);
  const resolved = log.findIndex((l) => / resolves its \[/.test(l.message));
  if (resolved < 0) return false;
  // the effect's own lines run until something else speaks (the turn moving on, say)
  const own = log.slice(resolved + 1);
  const end = own.findIndex((l) => l.sourceInstanceId !== prompt.sourceInstanceId);
  const lines = (end < 0 ? own : own.slice(0, end)).map((l) => l.message);
  // a miss logs itself, plus the engine's blank-named "sets  active"; anything else did something
  return lines.some((m) => /without a target/.test(m)) && lines.every((m) => /without a target| {2}/.test(m));
}
