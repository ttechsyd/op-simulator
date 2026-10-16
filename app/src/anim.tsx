import { useLayoutEffect, useRef, useState } from "react";
import type { BattleState, CardZone, MatchSeat, MatchState } from "@tcg/op-engine";
import { cardImage } from "./cards";
import { fly, hideUntil } from "./fly";
import { BOT, ME } from "./match";

const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

function rectOf(sel: string) {
  return document.querySelector(sel)?.getBoundingClientRect() ?? null;
}

// a box the size of `like`, centred on a zone: where a pile hands cards out and takes them back
function spot(sel: string, like: DOMRect) {
  const z = rectOf(sel);
  if (!z) return null;
  return new DOMRect(z.left + z.width / 2 - like.width / 2, z.top + z.height / 2 - like.height / 2, like.width, like.height);
}

const mat = (seat: MatchSeat) => (seat === ME ? ".mat.me" : ".mat.opp");

function pileOf(seat: MatchSeat, zone: CardZone) {
  if (zone === "deck") return `${mat(seat)} .pile.deck`;
  // an event being resolved is on its way to the trash
  if (zone === "trash" || zone === "resolution") return `${mat(seat)} .pile.trash`;
  if (zone === "life") return `${mat(seat)} .z-life`;
  if (zone === "hand") return seat === ME ? ".hand" : ".opp-hand";
  return null;
}

const faceDown = (zone: CardZone) => zone === "deck" || zone === "life" || zone === "hand";

// Every card on the table carries data-id. After each state change we compare where each
// id was drawn last time with where it is now and slide it over (FLIP). Cards that just
// arrived fly in from the pile they left, flipping face up on the way; cards that left
// fly out to the pile they went to. Things that are never drawn with an id, the far
// side's hand and the DON!!, are animated from the counts instead.
export function useCardMotion(state: MatchState) {
  const last = useRef(new Map<string, DOMRect>());
  const before = useRef<MatchState | null>(null);

  useLayoutEffect(() => {
    const prev = last.current;
    const was = before.current;
    before.current = state;
    const now = new Map<string, DOMRect>();
    // the table is scaled as a whole, so screen distances shrink before they become transforms
    const k = (document.querySelector(".stage")?.getBoundingClientRect().width ?? 960) / 960;

    for (const el of document.querySelectorAll<HTMLElement>("[data-id]")) {
      const id = el.dataset.id!;
      const r = el.getBoundingClientRect();
      now.set(id, r);
      if (!was || r.width === 0) continue;
      const from = prev.get(id);
      if (from) {
        const dx = (from.left - r.left) / k;
        const dy = (from.top - r.top) / k;
        const s = from.width / r.width;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3 && Math.abs(s - 1) < 0.05) continue;
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: "none" }],
          { duration: 340, easing: EASE, composite: "add" },
        );
        continue;
      }
      const c = state.cards[id];
      const old = was.cards[id]?.zone;
      if (!c || !old || old === c.zone || old === "resolution") continue;
      const sel = pileOf(c.owner, old);
      const origin = sel && spot(sel, r);
      if (!origin) continue;
      const hidden = el.classList.contains("back");
      const ms = fly({
        from: origin,
        to: r,
        img: hidden ? null : cardImage(c.cardId),
        face: hidden ? "down" : faceDown(old) ? "flipUp" : "up",
      });
      hideUntil(el, ms);
    }

    if (was) {
      for (const [id, from] of prev) {
        if (now.has(id)) continue;
        const c = state.cards[id];
        const old = was.cards[id]?.zone;
        if (!c || !old || old === c.zone) continue;
        const sel = pileOf(c.owner, c.zone);
        const to = sel && spot(sel, from);
        if (!to) continue;
        fly({ from, to, img: cardImage(c.cardId), face: faceDown(c.zone) ? "flipDown" : "up", rot: c.zone === "trash" || c.zone === "resolution" ? 12 : 0 });
      }

      for (const seat of [ME, BOT] as const) {
        const p = state.players[seat];
        const q = was.players[seat];
        const m = mat(seat);
        if (seat === BOT) {
          const drawn = p.hand.length - q.hand.length;
          const card = rectOf(`${m} .pile.deck .card`);
          if (drawn > 0 && card) {
            const src = p.life.length < q.life.length ? `${m} .z-life` : `${m} .pile.deck`;
            const to = spot(".opp-hand", card);
            const from = spot(src, card);
            if (to && from) for (let i = 0; i < drawn; i++) fly({ from, to, face: "down", delay: i * 90 });
          }
        }
        const don = rectOf(`${m} .z-dondeck .don`);
        if (!don) continue;
        const taken = p.activeDon + p.restedDon - (q.activeDon + q.restedDon);
        const cost = spot(`${m} .z-cost`, don);
        if (taken > 0 && p.donDeckCount < q.donDeckCount && cost) {
          for (let i = 0; i < taken; i++) fly({ from: don, to: cost, face: "down", don: true, dur: 340, delay: i * 90 });
        }
        // DON!! given to a card come out of the cost area, and go back there at refresh
        for (const [id, r] of now) {
          const c = state.cards[id];
          if (!c || c.owner !== seat || !cost) continue;
          const d = c.attachedDon - (was.cards[id]?.attachedDon ?? 0);
          const at = new DOMRect(r.left + r.width / 2 - don.width / 2, r.top + r.height / 2 - don.height / 2, don.width, don.height);
          for (let i = 0; i < Math.abs(d); i++) {
            fly(d > 0 ? { from: cost, to: at, face: "down", don: true, dur: 300, delay: i * 70 } : { from: at, to: cost, face: "down", don: true, dur: 300, delay: i * 70 });
          }
        }
      }
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
        <marker id="bhead" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
          <circle cx="5" cy="5" r="3.5" fill="#f6a06b" stroke="#8c491a" strokeWidth="1.5" />
        </marker>
      </defs>
      <line x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} stroke="#f6a06b" strokeWidth="4" strokeLinecap="round" markerEnd="url(#bhead)" />
    </svg>
  );
}
