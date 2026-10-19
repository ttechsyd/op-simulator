import { useEffect, useRef, useState } from "react";
import type {
  EngineCommand,
  MatchState,
  PotentialCardCommandDescriptor,
  ProjectedCard,
} from "@tcg/op-engine";
import { cardImage, cardName } from "./cards";
import { ME } from "./match";

function instanceName(state: MatchState, id: string) {
  const inst = state.cards[id];
  if (!inst) return id;
  const n = cardName(inst.cardId);
  return inst.zone === "leader" ? `Leader ${n}` : n;
}

// the strip's buttons say what, not to whom: the card they sit under is the whom
const SHORT: Record<string, string> = { playCard: "▲ Play", attachDon: "● DON!!", declareAttack: "⚔ Attack", activateEffect: "✦ Skill" };

// every card of the tapped group laid out big enough to read, scrolling sideways
export function Preview({
  group,
  start,
  state,
  actionsFor,
  step,
  send,
  onClose,
}: {
  group: ProjectedCard[];
  start: number;
  state: MatchState;
  actionsFor: (card: ProjectedCard) => PotentialCardCommandDescriptor[];
  // during a blocker or counter step the strip offers the prompt's answer on each usable card
  step?: { label: string; ids: Set<string>; pick: (id: string) => void };
  send: (c: EngineCommand) => void;
  onClose: () => void;
}) {
  const cards = group.filter((c) => !c.hidden && c.cardId);
  const [picking, setPicking] = useState<{ id: string; a: PotentialCardCommandDescriptor } | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const born = useRef(Date.now());

  useEffect(() => {
    const i = cards.findIndex((c) => c === group[start]);
    const el = strip.current?.children[Math.max(i, 0)] as HTMLElement | undefined;
    el?.scrollIntoView({ inline: "center", block: "nearest" });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (card: ProjectedCard, a: PotentialCardCommandDescriptor, targetId?: string) => {
    const id = card.instanceId!;
    let cmd: EngineCommand | null = null;
    switch (a.type) {
      case "playCard":
        cmd = { type: "playCard", seat: ME, instanceId: id, slotIndex: a.slotChoices?.[0] };
        break;
      case "attachDon":
        cmd = { type: "attachDon", seat: ME, targetId: id, amount: 1 };
        break;
      case "declareAttack":
        if (!targetId) {
          if (a.targetIds?.length === 1) targetId = a.targetIds[0];
          else {
            setPicking({ id, a });
            return;
          }
        }
        cmd = { type: "declareAttack", seat: ME, attackerId: id, targetId };
        break;
      case "activateEffect":
        cmd = { type: "activateEffect", seat: ME, sourceInstanceId: id, trigger: "activateMain" };
        break;
    }
    if (cmd) send(cmd);
    onClose();
  };

  return (
    <div
      className="preview"
      // the tap that opened this lands its click here a moment later; on a phone the card's
      // own Play button can be right under the finger, so swallow it before anything sees it
      onClickCapture={(e) => Date.now() - born.current < 350 && e.stopPropagation()}
      onClick={onClose}
    >
      <div
        className="strip"
        ref={strip}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => {
          if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY;
        }}
      >
        {cards.map((card, i) => {
          const actions = actionsFor(card);
          const pick = picking?.id === card.instanceId ? picking.a : null;
          return (
            <div className="pv-card" key={card.instanceId ?? i}>
              <img src={cardImage(card.cardId!)} alt={card.name ?? ""} draggable={false} />
              <div className="pv-actions">
                {step && card.instanceId && step.ids.has(card.instanceId) && (
                  <button className="act" onClick={() => { step.pick(card.instanceId!); onClose(); }}>{step.label}</button>
                )}
                {pick
                  ? [
                      ...pick.targetIds!.map((t) => (
                        <button key={t} onClick={() => run(card, pick, t)}>
                          {instanceName(state, t)}
                        </button>
                      )),
                      <button key="back" className="ghost" onClick={() => setPicking(null)}>Back</button>,
                    ]
                  : actions.map((a, k) => (
                      <button key={k} className="act" disabled={!a.enabled} onClick={() => run(card, a)} title={a.disabledReason}>
                        {SHORT[a.type] ?? a.label}
                      </button>
                    ))}
                {/* phones never show a title, so say why when nothing here can be pressed */}
                {!pick && actions.length > 0 && actions.every((a) => !a.enabled) && actions[0].disabledReason && (
                  <small className="why">{actions[0].disabledReason}</small>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <button className="pv-close" onClick={onClose} aria-label="close">✕</button>
      {cards.length > 1 && <div className="pv-count">{cards.length} cards</div>}
    </div>
  );
}
