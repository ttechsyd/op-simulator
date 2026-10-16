import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { EngineCommand, MatchState, PromptState } from "@tcg/op-engine";
import { cardImage, cardName } from "./cards";
import { ME } from "./match";
import type { DragSource } from "./drag";

// prompts that are really about a handful of cards get laid out face up above the
// board instead of a list of buttons: searches, "look at the top N", ordering the
// rest back into the deck, life triggers. Everything else stays on the PromptSheet.
export type TrayMode = "pick" | "order" | "place" | "trigger";

export function trayMode(p: PromptState): TrayMode | null {
  const rc = p.resolutionContext;
  if (rc?.intent === "battleCounter" || rc?.intent === "battleBlocker") return null;
  if (p.choiceKind === "confirm" && (rc?.intent === "lifeTrigger" || rc?.intent === "effectRevealFromLifePlay")) return "trigger";
  if (p.choiceKind === "chooseOption" && p.context.position === "topOrBottom") return "place";
  if (!p.options.length || !p.options.every((o) => o.targetId)) return null;
  if (p.choiceKind === "orderCards") return "order";
  if (p.choiceKind === "selectCards" || p.choiceKind === "selectTargets" || p.choiceKind === "costPayment") return "pick";
  return null;
}

// the cards a "top or bottom" prompt is about live in its resolution context
function placedIds(p: PromptState): string[] {
  const rc = p.resolutionContext as Record<string, unknown> | null;
  for (const k of ["orderedIds", "lookedIds", "targetIds"]) {
    const v = rc?.[k];
    if (Array.isArray(v) && v.length) return v as string[];
  }
  return [];
}

export const DECK_KEYS = ["deck:top", "deck:bottom"];

export function pickTargets(p: PromptState): Set<string> {
  const s = new Set<string>();
  for (const o of p.options) if (o.targetId && o.enabled !== false) s.add(o.targetId);
  return s;
}

// the card a confirm-style prompt is about: the life card with the trigger, or the one just revealed
export function shownCard(p: PromptState, state: MatchState): string {
  const rc = p.resolutionContext;
  if (rc?.intent === "effectRevealFromLifePlay") return state.players[rc.owner].life[0]!;
  return p.sourceInstanceId!;
}

export function Tray({
  prompt,
  mode,
  state,
  picked,
  setPicked,
  send,
  press,
}: {
  prompt: PromptState;
  mode: TrayMode;
  state: MatchState;
  // picks live in App so dragging a hand card onto the trash counts as one too
  picked: string[];
  setPicked: (f: (p: string[]) => string[]) => void;
  send: (c: EngineCommand) => void;
  press: (e: ReactPointerEvent, source: DragSource, tap?: () => void) => void;
}) {
  const base = { type: "resolvePrompt" as const, seat: ME, promptId: prompt.id };
  const [order, setOrder] = useState(() => prompt.options.map((o) => o.id));
  const [lifting, setLifting] = useState<{ id: string; x: number; y: number } | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  const ids =
    mode === "trigger" ? [shownCard(prompt, state)] : mode === "place" ? placedIds(prompt) : mode === "order" ? order : prompt.options.map((o) => o.id);
  const cardId = (id: string) => prompt.options.find((o) => o.id === id)?.targetId ?? id;
  const enabled = (id: string) => prompt.options.find((o) => o.id === id)?.enabled !== false;

  const toggle = (id: string) => {
    if (!enabled(id)) return;
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      if (p.length >= prompt.maxSelections) return prompt.maxSelections === 1 ? [id] : p;
      return [...p, id];
    });
  };

  // reordering: the lifted card follows the finger as a ghost while its hole moves
  // through the strip to wherever the finger is
  const lift = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    let on = false;
    const move = (ev: PointerEvent) => {
      if (!on) {
        if (Math.abs(ev.clientX - sx) < 8) return;
        on = true;
      }
      ev.preventDefault();
      setLifting({ id, x: ev.clientX, y: ev.clientY });
      const kids = Array.from(strip.current?.children ?? []) as HTMLElement[];
      let at = kids.length - 1;
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) {
          at = i;
          break;
        }
      }
      setOrder((o) => {
        const from = o.indexOf(id);
        if (from === at) return o;
        const next = o.filter((x) => x !== id);
        next.splice(at, 0, id);
        return next;
      });
    };
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
      setLifting(null);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  };

  const pressPlaced = (e: ReactPointerEvent, id: string) => {
    const card = state.cards[id];
    press(e, {
      kind: "free",
      cardId: card.cardId,
      targets: new Set(DECK_KEYS),
      drop: (key) => send({ ...base, optionId: key.slice("deck:".length) }),
    });
  };

  const b = state.battle;
  const sourceName = prompt.sourceInstanceId ? cardName(state.cards[prompt.sourceInstanceId].cardId) : null;
  const hint = {
    pick: prompt.details,
    order: "Drag to order. Left is first.",
    place: "Drag onto the top or bottom of your deck.",
    trigger: prompt.resolutionContext?.intent === "lifeTrigger" ? "This life card has a [Trigger]." : prompt.details,
  }[mode];

  return (
    <div className={`tray ${mode}`} data-drop="tray">
      <div className="tray-head">
        {sourceName && <b>{sourceName}</b>}
        <span>{hint || prompt.label}</span>
        {b && (
          <span className="battle">
            {cardName(state.cards[b.attackerId].cardId)} {b.attackPower} ⚔ {cardName(state.cards[b.targetId].cardId)} {b.defensePower + (b.powerCompared ? 0 : b.counterTotal)}
          </span>
        )}
      </div>

      <div className="strip" ref={strip}>
        {ids.map((id, i) => {
          const cls = ["tray-card"];
          if (mode === "pick") cls.push(picked.includes(id) ? "on" : enabled(id) ? "" : "off");
          if (lifting?.id === id) cls.push("hole");
          return (
            <div
              key={id}
              className={cls.join(" ")}
              onClick={mode === "pick" ? () => toggle(id) : undefined}
              onPointerDown={mode === "order" ? (e) => lift(e, id) : mode === "place" ? (e) => pressPlaced(e, id) : undefined}
            >
              <img src={cardImage(state.cards[cardId(id)].cardId)} alt="" draggable={false} />
              {mode === "order" && <span className="n">{i + 1}</span>}
              {mode === "pick" && picked.includes(id) && <span className="n">{picked.indexOf(id) + 1}</span>}
            </div>
          );
        })}
      </div>

      {lifting && (
        <div className="drag-ghost" style={{ left: lifting.x, top: lifting.y }}>
          <img src={cardImage(state.cards[cardId(lifting.id)].cardId)} alt="" />
        </div>
      )}

      <div className="tray-actions">
        {mode === "pick" && (
          <>
            <button disabled={picked.length < prompt.minSelections} onClick={() => send({ ...base, selectedIds: picked })}>
              {picked.length === 0 ? (prompt.minSelections === 0 ? "Take none" : `Pick ${prompt.minSelections}`) : `Confirm ${picked.length}/${prompt.maxSelections}`}
            </button>
            {picked.length > 0 && <button className="ghost" onClick={() => setPicked(() => [])}>Clear</button>}
          </>
        )}
        {mode === "order" && <button onClick={() => send({ ...base, selectedIds: order })}>Done</button>}
        {mode === "place" &&
          prompt.options.map((o) => (
            <button key={o.id} className="ghost" onClick={() => send({ ...base, optionId: o.id })}>
              {o.label}
            </button>
          ))}
        {mode === "trigger" &&
          prompt.options.map((o) => (
            <button key={o.id} className={o.id === "skip" ? "ghost" : ""} onClick={() => send({ ...base, optionId: o.id })}>
              {o.label}
            </button>
          ))}
      </div>
    </div>
  );
}
