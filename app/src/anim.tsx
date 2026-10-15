import { useLayoutEffect, useRef, useState } from "react";
import type { BattleState, MatchState } from "@tcg/op-engine";
import { BOT, ME } from "./match";

const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

function rectOf(sel: string) {
  return document.querySelector(sel)?.getBoundingClientRect() ?? null;
}

// Every card on the table carries data-id. After each state change we compare where
// each id was drawn last time with where it is now and slide it over (FLIP). Cards
// that just appeared come from wherever they must have been: my draws from the deck
// (or the life stack when life just dropped), the bot's plays from its hand.
export function useCardMotion(state: MatchState) {
  const last = useRef(new Map<string, DOMRect>());
  const lastLife = useRef(state.players[ME].life.length);

  useLayoutEffect(() => {
    const prev = last.current;
    const now = new Map<string, DOMRect>();
    const fromLife = state.players[ME].life.length < lastLife.current;
    lastLife.current = state.players[ME].life.length;

    const origin = (id: string) => {
      const c = state.cards[id];
      if (!c) return null;
      if (c.zone === "hand") return rectOf(fromLife ? ".seat.me .z-life" : ".seat.me .pile.deck");
      if (c.owner === BOT) return rectOf(".seat.opp .z-corner");
      return null;
    };

    for (const el of document.querySelectorAll<HTMLElement>("[data-id]")) {
      const id = el.dataset.id!;
      const r = el.getBoundingClientRect();
      now.set(id, r);
      if (prev.size === 0) continue;
      const from = prev.get(id) ?? origin(id);
      if (!from || r.width === 0) continue;
      const dx = from.left - r.left;
      const dy = from.top - r.top;
      const s = from.width / r.width;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3 && Math.abs(s - 1) < 0.05) continue;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: prev.has(id) ? 1 : 0.4 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 340, easing: EASE, composite: "add" },
      );
    }
    last.current = now;
  }, [state]);
}

export function BattleArrow({ battle }: { battle: BattleState | null }) {
  const [line, setLine] = useState<[number, number, number, number] | null>(null);
  useLayoutEffect(() => {
    if (!battle) {
      setLine(null);
      return;
    }
    const place = () => {
      const a = document.querySelector(`[data-id="${battle.attackerId}"]`)?.getBoundingClientRect();
      const t = document.querySelector(`[data-id="${battle.targetId}"]`)?.getBoundingClientRect();
      if (!a || !t) return setLine(null);
      setLine([a.left + a.width / 2, a.top + a.height / 2, t.left + t.width / 2, t.top + t.height / 2]);
    };
    // wait for any slide-over to finish so the arrow lands on the resting spot
    const id = setTimeout(place, 360);
    place();
    window.addEventListener("resize", place);
    return () => {
      clearTimeout(id);
      window.removeEventListener("resize", place);
    };
  }, [battle]);
  if (!line) return null;
  return (
    <svg className="drag-arrow battle-arrow" width="100%" height="100%">
      <defs>
        <marker id="bhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#ff5252" />
        </marker>
      </defs>
      <line x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} stroke="#ff5252" strokeWidth="3" strokeLinecap="round" markerEnd="url(#bhead)" />
    </svg>
  );
}
