import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { getCard } from "@tcg/op-cards";
import type { MatchPhase, ProjectedCard, ProjectedPlayerState } from "@tcg/op-engine";
import { cardImage } from "./cards";
import { retryArt } from "./decks";

// a press is a tap or the start of a drag; the game decides which, and gets the
// group the card sits in so a tap can open the strip on it
// `at` reports which card the pointer is over right now; the hand lets a finger slide
// along the fan before it commits, so the card that was first touched may not be the one meant
export type Press = (e: ReactPointerEvent, card: ProjectedCard, group: ProjectedCard[], at?: () => ProjectedCard) => void;

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

function printedPower(cardId: string) {
  const c = getCard(cardId);
  return "power" in c && typeof c.power === "number" ? c.power : null;
}

export function CardView({
  card,
  group,
  press,
  lit,
  on,
  dim,
  dropKey,
  drop,
  label,
  style,
  marks,
}: {
  card: ProjectedCard | null;
  group?: ProjectedCard[];
  press?: Press;
  lit?: boolean;
  // picked for a prompt that is still being answered
  on?: boolean;
  dim?: boolean;
  dropKey?: string;
  drop?: Drop;
  // what an empty slot says about itself
  label?: string;
  style?: CSSProperties;
  // what the card can do right now, stacked in its corner: ATK, SKILL, +2000...
  marks?: string[];
}) {
  const dc = dropClass(dropKey, drop);
  if (!card)
    return (
      <div className={`card slot ${dc}`} data-drop={dropKey}>
        {label && <span className="zlabel">{label}</span>}
      </div>
    );
  const cls = ["card", card.rested ? "rested" : "", lit ? "lit" : "", on ? "on" : "", dim ? "dim" : "", dc].join(" ");
  const buffed = card.power !== null && card.zone !== "hand" && !!card.cardId && card.power !== printedPower(card.cardId);
  const face =
    card.hidden || !card.cardId ? (
      <div className={`${cls} back`} data-id={card.instanceId ?? undefined} style={style} />
    ) : (
      <div
        className={cls}
        data-drop={dropKey}
        data-id={card.instanceId ?? undefined}
        style={style}
        onPointerDown={press ? (e) => press(e, card, group ?? [card]) : undefined}
      >
        <img src={cardImage(card.cardId)} alt={card.name ?? card.cardId} draggable={false} onError={(e) => retryArt(e.currentTarget)} />
        {card.power !== null && card.zone !== "hand" && <span className={`pow ${buffed ? "up" : ""}`}>{card.power}</span>}
        {marks && marks.length > 0 && (
          <span className="marks">
            {marks.map((m) => <b key={m}>{m}</b>)}
          </span>
        )}
      </div>
    );
  if (!card.attachedDon) return face;
  // attached DON peek out from under the card, like on a real table
  return (
    <div className="stack" style={{ paddingBottom: `calc(var(--tab) * ${card.attachedDon})` }}>
      {Array.from({ length: card.attachedDon }, (_, i) => (
        <div key={i} className="don-under" style={{ top: `calc(var(--tab) * ${i + 1})` }} />
      ))}
      {face}
    </div>
  );
}

function Don({ rested, press }: { rested?: boolean; press?: (e: ReactPointerEvent) => void }) {
  return <div className={`don ${rested ? "rested" : ""} ${press ? "grab" : ""} ${rested && press ? "lit" : ""}`} onPointerDown={press} />;
}

// life[0] is the top of the stack; a card turned face up by an effect stays visible
function Life({ cards, press }: { cards: ProjectedCard[]; press?: Press }) {
  const up = cards.filter((c) => !c.hidden);
  return (
    <div className="life">
      <div className="life-stack">
        {cards.map((c, i) =>
          c.hidden ? (
            <div key={i} className="life-card" style={{ zIndex: cards.length - i }} />
          ) : (
            <div
              key={c.instanceId ?? i}
              className="life-card up"
              style={{ zIndex: cards.length - i }}
              data-id={c.instanceId ?? undefined}
              onPointerDown={press ? (e) => press(e, c, up) : undefined}
            >
              <img src={cardImage(c.cardId!)} alt="" draggable={false} />
            </div>
          ),
        )}
      </div>
      <span className="zlabel">{cards.length ? `Life ${cards.length}` : "No life · next hit wins"}</span>
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

export function Phases({ current }: { current: MatchPhase | null }) {
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

// the far side's hand, face down, peeking over the top edge of the table
export function OppHand({ count }: { count: number }) {
  return (
    <div className="opp-hand">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card back" style={{ transform: `rotate(${(i - (count - 1) / 2) * -3}deg)` }} />
      ))}
    </div>
  );
}

export function Seat({
  p,
  opponent,
  press,
  pressDon,
  pressRestedDon,
  drop,
  litIds,
  onIds,
  marks,
  corner,
  actions,
  onDeck,
  onDon,
  deckSplit,
}: {
  p: ProjectedPlayerState;
  opponent?: boolean;
  press?: Press;
  pressDon?: (e: ReactPointerEvent) => void;
  // a skill that gives a rested DON!! lets you drag one to the card you mean
  pressRestedDon?: (e: ReactPointerEvent) => void;
  drop?: Drop;
  litIds?: Set<string>;
  onIds?: Set<string>;
  marks?: Map<string, string[]>;
  // whatever lives in the mat's spare cell: phases and End turn on mine, name and log on theirs
  corner?: ReactNode;
  // End turn and friends, on the bottom row beside the cost area
  actions?: ReactNode;
  // the turn's draw and DON!! wait on the piles until tapped
  onDeck?: () => void;
  onDon?: () => void;
  // a "top or bottom of the deck" prompt is answered by dropping or tapping on half the pile
  deckSplit?: (half: "top" | "bottom") => void;
}) {
  const lit = (c: ProjectedCard | null) => !!c?.instanceId && !!litIds?.has(c.instanceId);
  const on = (c: ProjectedCard | null) => !!c?.instanceId && !!onIds?.has(c.instanceId);
  const marksOf = (c: ProjectedCard | null) => (c?.instanceId ? marks?.get(c.instanceId) : undefined);
  // the leader flinches when a life card is taken
  const [hit, setHit] = useState(false);
  const lastLife = useRef(p.lifeCount);
  useEffect(() => {
    const dropped = p.lifeCount < lastLife.current;
    lastLife.current = p.lifeCount;
    if (!dropped) return;
    setHit(true);
    const t = setTimeout(() => setHit(false), 500);
    return () => clearTimeout(t);
  }, [p.lifeCount]);
  const field = [p.leader, ...p.characters, p.stage].filter((c): c is ProjectedCard => !!c);
  const own = opponent ? "opp" : "mine";
  const key = (c: ProjectedCard | null, empty?: string) => (c?.instanceId ? `${own}:${c.instanceId}` : empty);
  const trashTop = p.trash[p.trash.length - 1] ?? null;
  return (
    <div className={`mat ${opponent ? "opp" : "me"}`} data-drop={opponent ? undefined : "side"}>
      <div className={`z-life ${opponent ? "" : dropClass("life", drop)}`} data-drop={opponent ? undefined : "life"}>
        <Life cards={p.life} press={press} />
      </div>

      <div className="z-chars">
        {p.characters.map((c, i) => (
          <CardView
            key={c?.instanceId ?? `empty${i}`}
            card={c}
            group={field}
            press={press}
            lit={lit(c)}
            on={on(c)}
            marks={marksOf(c)}
            dropKey={key(c, opponent ? undefined : `slot:${i}`)}
            drop={drop}
          />
        ))}
      </div>

      <div className="z-lead">
        <div className={hit ? "hit" : ""}>
          <CardView card={p.leader} group={field} press={press} lit={lit(p.leader)} on={on(p.leader)} marks={marksOf(p.leader)} dropKey={key(p.leader)} drop={drop} />
        </div>
        <CardView card={p.stage} group={field} press={press} lit={lit(p.stage)} on={on(p.stage)} marks={marksOf(p.stage)} dropKey={opponent ? undefined : "stage"} drop={drop} label="Stage" />
      </div>

      <div className="z-piles">
        <div
          className={`pile deck ${onDeck ? "lit" : ""} ${opponent ? "" : dropClass("deck", drop)}`}
          data-drop={opponent || deckSplit ? undefined : "deck"}
          onClick={onDeck}
        >
          <div className="card back" />
          <span className="count">{p.deckCount}</span>
          {deckSplit &&
            (["top", "bottom"] as const).map((half) => (
              <div
                key={half}
                className={`deck-half ${half} ${dropClass(`deck:${half}`, drop) || "drop-ok"}`}
                data-drop={`deck:${half}`}
                onClick={() => deckSplit(half)}
              >
                {half}
              </div>
            ))}
        </div>
        <div className={`pile trash ${opponent ? "" : dropClass("trash", drop)}`} data-drop={opponent ? undefined : "trash"}>
          <CardView card={trashTop} group={p.trash} press={press} label="Trash" />
          {p.trash.length > 0 && <span className="count">{p.trash.length}</span>}
        </div>
      </div>

      <div className={`z-dondeck ${onDon ? "lit" : ""}`} onClick={onDon}>
        <Don />
        <span className="don-count">{p.donDeckCount}</span>
      </div>

      <div className="z-cost">
        {Array.from({ length: p.activeDon }, (_, i) => <Don key={`a${i}`} press={pressDon} />)}
        {Array.from({ length: p.restedDon }, (_, i) => <Don key={`r${i}`} rested press={pressRestedDon} />)}
        <span className="zlabel">{opponent ? "Cost area" : `Cost area · ${p.activeDon} active`}</span>
      </div>

      <div className="z-corner">{corner}</div>
      {actions && <div className="z-act">{actions}</div>}
    </div>
  );
}

// fanned along the bottom edge with only the tops showing; lifts to read, or tap the felt beside it
export function Hand({
  cards,
  press,
  litIds,
  onIds,
  dim,
  marks,
  pos,
  onLift,
}: {
  cards: ProjectedCard[];
  press: Press;
  litIds?: Set<string>;
  onIds?: Set<string>;
  // a counter or blocker step greys out the cards that can't answer it
  dim?: boolean;
  marks?: Map<string, string[]>;
  pos: "" | "up" | "half" | "tuck";
  onLift: (up: boolean | "toggle") => void;
}) {
  const n = cards.length;
  const step = Math.min(60, n > 1 ? (900 - 80) / (n - 1) : 60);
  const fan = useRef<HTMLDivElement>(null);
  // the card under the finger while it slides along the fan; it rises so you can read it
  const [peek, setPeek] = useState<string | null>(null);
  const peeking = useRef<ProjectedCard | null>(null);

  const under = (x: number) => {
    const els = fan.current?.querySelectorAll<HTMLElement>(".card") ?? [];
    let hit: ProjectedCard | null = null;
    // later cards overlap earlier ones, so the last match wins
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right) hit = cards[i];
    });
    return hit;
  };

  const touch = (e: ReactPointerEvent, c: ProjectedCard) => {
    if (e.button !== 0 || c.hidden || !c.cardId) return;
    const settle = (card: ProjectedCard | null) => {
      peeking.current = card;
      setPeek(card?.instanceId ?? null);
    };
    settle(c);
    const finger = e.pointerType !== "mouse";
    if (finger) onLift(true);
    const move = (ev: PointerEvent) => settle(under(ev.clientX));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      settle(null);
      if (finger) onLift(false);
    };
    // the press goes first so its tap still sees which card the finger ended on
    press(e, c, cards, () => peeking.current ?? c);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <div
      className={`hand ${pos}`}
      ref={fan}
      onPointerEnter={(e) => e.pointerType === "mouse" && onLift(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && onLift(false)}
    >
      {cards.map((c, i) => {
        const off = i - (n - 1) / 2;
        const lit = !!c.instanceId && !!litIds?.has(c.instanceId);
        const up = !!c.instanceId && c.instanceId === peek && pos !== "tuck";
        return (
          <CardView
            key={c.instanceId ?? i}
            card={c}
            group={cards}
            press={touch}
            lit={lit}
            on={!!c.instanceId && !!onIds?.has(c.instanceId)}
            dim={dim && !lit}
            marks={c.instanceId ? marks?.get(c.instanceId) : undefined}
            style={{
              marginLeft: i ? step - 80 : 0,
              transform: up ? "translateY(-54px) scale(1.35)" : `rotate(${off * 3}deg) translateY(${Math.abs(off) * 3}px)`,
              zIndex: up ? 5 : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
