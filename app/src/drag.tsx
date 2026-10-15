import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { EngineCommand, PotentialCardCommandDescriptor, ProjectedCard } from "@tcg/op-engine";
import { getCard } from "@tcg/op-cards";
import { cardImage } from "./cards";
import { ME } from "./match";

export type DragSource =
  | { kind: "hand"; card: ProjectedCard }
  | { kind: "attacker"; card: ProjectedCard }
  | { kind: "don" }
  | { kind: "look"; card: ProjectedCard };

// drop keys are plain strings on data-drop attributes:
//   slot:<n>  stage  side  mine:<instanceId>  opp:<instanceId>
export interface DragState {
  source: DragSource;
  sx: number;
  sy: number;
  x: number;
  y: number;
  targets: Set<string>;
  over: string | null;
}

// where each of my characters sits on screen; slot positions mean nothing to the rules
export type Layout = (string | null)[];

export function settleLayout(layout: Layout, chars: (ProjectedCard | null)[]): Layout {
  const ids = new Set(chars.map((c) => c?.instanceId ?? null));
  const next: Layout = layout.map((id) => (id && ids.has(id) ? id : null));
  while (next.length < chars.length) next.push(null);
  chars.forEach((c, i) => {
    if (!c?.instanceId || next.includes(c.instanceId)) return;
    const at = next[i] === null ? i : next.indexOf(null);
    if (at >= 0) next[at] = c.instanceId;
  });
  return next;
}

export function useDrag(
  potential: PotentialCardCommandDescriptor[],
  send: (c: EngineCommand) => void,
  layout: Layout,
  place: (instanceId: string, at: number) => void,
) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const live = useRef<DragState | null>(null);

  const targetsFor = (source: DragSource): Set<string> => {
    const out = new Set<string>();
    if (source.kind === "hand") {
      const a = potential.find((p) => p.type === "playCard" && p.sourceId === source.card.instanceId);
      if (!a?.enabled) return out;
      const type = getCard(source.card.cardId!).cardType;
      if (type === "character") {
        if (a.slotChoices?.length) layout.forEach((id, i) => id === null && out.add(`slot:${i}`));
      } else if (type === "stage") out.add("stage");
      else out.add("side");
    } else if (source.kind === "don") {
      for (const p of potential) if (p.type === "attachDon" && p.enabled && p.sourceId) out.add(`mine:${p.sourceId}`);
    } else if (source.kind === "attacker") {
      const a = potential.find((p) => p.type === "declareAttack" && p.sourceId === source.card.instanceId);
      if (a?.enabled) for (const t of a.targetIds ?? []) out.add(`opp:${t}`);
      if (source.card.zone === "character") {
        const here = layout.indexOf(source.card.instanceId);
        layout.forEach((_, i) => i !== here && out.add(`slot:${i}`));
      }
    }
    return out;
  };

  const perform = (source: DragSource, key: string) => {
    const [kind, arg] = key.split(":");
    if (source.kind === "hand") {
      const a = potential.find((p) => p.type === "playCard" && p.sourceId === source.card.instanceId);
      send({ type: "playCard", seat: ME, instanceId: source.card.instanceId!, slotIndex: a?.slotChoices?.[0] });
      if (kind === "slot") place(source.card.instanceId!, Number(arg));
    } else if (source.kind === "don" && kind === "mine") {
      send({ type: "attachDon", seat: ME, targetId: arg, amount: 1 });
    } else if (source.kind === "attacker") {
      if (kind === "opp") send({ type: "declareAttack", seat: ME, attackerId: source.card.instanceId!, targetId: arg });
      else if (kind === "slot") place(source.card.instanceId!, Number(arg));
    }
  };

  // one handler for both tapping and dragging: a short press without movement is a tap
  const press = (e: ReactPointerEvent, source: DragSource, tap?: () => void) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const targets = targetsFor(source);
    let dragging = false;

    const keyUnder = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
      const key = el?.dataset.drop ?? null;
      return key && targets.has(key) ? key : null;
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 10) return;
        if (targets.size === 0) {
          stop();
          return;
        }
        dragging = true;
      }
      ev.preventDefault();
      const next = { source, sx, sy, x: ev.clientX, y: ev.clientY, targets, over: keyUnder(ev.clientX, ev.clientY) };
      live.current = next;
      setDrag(next);
    };

    const up = (ev: PointerEvent) => {
      stop();
      if (!dragging) {
        tap?.();
        return;
      }
      const key = keyUnder(ev.clientX, ev.clientY);
      if (key) perform(source, key);
      live.current = null;
      setDrag(null);
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    const cancel = () => {
      stop();
      live.current = null;
      setDrag(null);
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  return { drag, press };
}

export function DragLayer({ drag }: { drag: DragState | null }) {
  if (!drag) return null;
  const { source, sx, sy, x, y } = drag;
  const attacking = source.kind === "attacker" && drag.over?.startsWith("opp:");
  return (
    <>
      {source.kind === "attacker" && (
        <svg className="drag-arrow" width="100%" height="100%">
          <defs>
            <marker id="head" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill={attacking ? "#ff5252" : "#ffffff88"} />
            </marker>
          </defs>
          <line
            x1={sx} y1={sy} x2={x} y2={y}
            stroke={attacking ? "#ff5252" : "#ffffff88"}
            strokeWidth="4" strokeLinecap="round" markerEnd="url(#head)"
          />
        </svg>
      )}
      <div className={`ghost ${source.kind === "don" ? "don-ghost" : ""}`} style={{ left: x, top: y }}>
        {source.kind === "don" ? <div className="don" /> : source.kind !== "look" && <img src={cardImage(source.card.cardId!)} alt="" />}
      </div>
    </>
  );
}
