import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { MatchPhase, ProjectedCard, ProjectedPlayerState } from "@tcg/op-engine";
import { cardImage } from "./cards";

// a press is a tap or the start of a drag; the game decides which, and gets the
// group the card sits in so a tap can open the strip on it
export type Press = (e: ReactPointerEvent, card: ProjectedCard, group: ProjectedCard[]) => void;

export interface Drop {
  ok: Set<string>;
  over: string | null;
}

function dropClass(key: string | undefined, drop?: Drop) {
  if (!key || !drop) return "";
  if (drop.over === key) return "drop-over";
  if (drop.ok.has(key)) return "drop-ok";
  return "";
}

export function CardView({
  card,
  group,
  press,
  lit,
  size = "field",
  dropKey,
  drop,
}: {
  card: ProjectedCard | null;
  group?: ProjectedCard[];
  press?: Press;
  lit?: boolean;
  size?: "field" | "inhand";
  dropKey?: string;
  drop?: Drop;
}) {
  const dc = dropClass(dropKey, drop);
  if (!card) return <div className={`card slot ${size} ${dc}`} data-drop={dropKey} />;
  const cls = ["card", size, card.rested ? "rested" : "", lit ? "lit" : "", dc].join(" ");
  const face =
    card.hidden || !card.cardId ? (
      <div className={`${cls} back`} />
    ) : (
      <div
        className={cls}
        data-drop={dropKey}
        onPointerDown={press ? (e) => press(e, card, group ?? [card]) : undefined}
      >
        <img src={cardImage(card.cardId)} alt={card.name ?? card.cardId} draggable={false} />
        {card.power !== null && card.zone !== "hand" && <span className="pow">{card.power}</span>}
      </div>
    );
  if (!card.attachedDon) return face;
  // attached DON peek out from under the card, like on a real table
  return (
    <div className="stack" style={{ paddingBottom: card.attachedDon * 6 }}>
      {Array.from({ length: card.attachedDon }, (_, i) => (
        <div key={i} className="don-under" style={{ top: (i + 1) * 6 }} />
      ))}
      {face}
    </div>
  );
}

function Don({ rested, press }: { rested?: boolean; press?: (e: ReactPointerEvent) => void }) {
  return <div className={`don ${rested ? "rested" : ""} ${press ? "grab" : ""}`} onPointerDown={press} />;
}

function Life({ count }: { count: number }) {
  return (
    <div className="life" style={{ height: 16 + Math.max(count - 1, 0) * 7 }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="life-card" style={{ top: i * 7 }} />
      ))}
      <span className="count">{count}</span>
    </div>
  );
}

const PHASES: { id: MatchPhase; label: string }[] = [
  { id: "refresh", label: "Refresh" },
  { id: "draw", label: "Draw" },
  { id: "don", label: "DON!!" },
  { id: "main", label: "Main" },
  { id: "end", label: "End" },
];

function Phases({ current }: { current: MatchPhase | null }) {
  return (
    <div className="phases">
      {PHASES.map((p) => (
        <div key={p.id} className={`phase ${p.id === current || (p.id === "main" && current === "battle") ? "now" : ""}`}>
          {p.label}
        </div>
      ))}
    </div>
  );
}

export function Seat({
  p,
  opponent,
  phase,
  press,
  pressDon,
  drop,
  litIds,
  corner,
}: {
  p: ProjectedPlayerState;
  opponent?: boolean;
  phase: MatchPhase | null;
  press?: Press;
  pressDon?: (e: ReactPointerEvent) => void;
  drop?: Drop;
  litIds?: Set<string>;
  corner?: ReactNode;
}) {
  const lit = (c: ProjectedCard | null) => !!c?.instanceId && !!litIds?.has(c.instanceId);
  const field = [p.leader, ...p.characters, p.stage].filter((c): c is ProjectedCard => !!c);
  const own = opponent ? "opp" : "mine";
  const key = (c: ProjectedCard | null, empty?: string) => (c?.instanceId ? `${own}:${c.instanceId}` : empty);
  const trashTop = p.trash[p.trash.length - 1] ?? null;
  return (
    <div className={`seat ${opponent ? "opp" : "me"}`} data-drop={opponent ? undefined : "side"}>
      <div className="z-life">
        <Life count={p.lifeCount} />
      </div>

      <div className="z-chars">
        {p.characters.map((c, i) => (
          <CardView
            key={c?.instanceId ?? `empty${i}`}
            card={c}
            group={field}
            press={press}
            lit={lit(c)}
            dropKey={key(c, opponent ? undefined : `slot:${i}`)}
            drop={drop}
          />
        ))}
      </div>

      <div className="z-lead">
        <Phases current={phase} />
        <CardView card={p.leader} group={field} press={press} lit={lit(p.leader)} dropKey={key(p.leader)} drop={drop} />
        <CardView card={p.stage} group={field} press={press} dropKey={opponent ? undefined : "stage"} drop={drop} />
      </div>

      <div className="z-piles">
        <div className="pile deck">
          <div className="card back" />
          <span className="count">{p.deckCount}</span>
        </div>
        <div className="pile trash">
          <CardView card={trashTop} group={p.trash} press={press} />
          {p.trash.length > 0 && <span className="count">{p.trash.length}</span>}
        </div>
      </div>

      <div className="z-dondeck pile">
        <Don />
        <span className="count">{p.donDeckCount}</span>
      </div>

      <div className="z-cost">
        {Array.from({ length: p.activeDon }, (_, i) => <Don key={`a${i}`} press={pressDon} />)}
        {Array.from({ length: p.restedDon }, (_, i) => <Don key={`r${i}`} rested />)}
      </div>

      <div className="z-corner">
        <div className="who">
          <b>{p.playerName}</b> · {p.handCount} in hand
        </div>
        {corner}
      </div>
    </div>
  );
}

export function Hand({ cards, press, litIds }: { cards: ProjectedCard[]; press: Press; litIds?: Set<string> }) {
  return (
    <div className="hand">
      {cards.map((c, i) => (
        <CardView
          key={c.instanceId ?? i}
          card={c}
          group={cards}
          size="inhand"
          press={press}
          lit={!!c.instanceId && !!litIds?.has(c.instanceId)}
        />
      ))}
    </div>
  );
}
