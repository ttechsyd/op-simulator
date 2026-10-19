import { useState, type ReactNode } from "react";
import type {
  MatchSeat,
  EngineCommand,
  LegalCommandDescriptor,
  MatchState,
  ProjectedCard,
  PromptState,
} from "@tcg/op-engine";
import { cardImage, cardName } from "./cards";
import { ME } from "./match";

export function Sheet({ children, onClose, wide }: { children: ReactNode; onClose?: () => void; wide?: boolean }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className={`sheet ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function instanceName(state: MatchState, id: string) {
  const inst = state.cards[id];
  if (!inst) return id;
  const n = cardName(inst.cardId);
  return inst.zone === "leader" ? `Leader ${n}` : n;
}

export function PromptSheet({
  prompt,
  state,
  send,
}: {
  prompt: PromptState;
  state: MatchState;
  send: (c: EngineCommand) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const multi =
    prompt.choiceKind === "selectCards" ||
    prompt.choiceKind === "selectTargets" ||
    prompt.choiceKind === "costPayment" ||
    prompt.choiceKind === "orderCards";

  const base = { type: "resolvePrompt" as const, seat: ME, promptId: prompt.id };

  if (prompt.resolutionContext?.intent === "loopIterations") {
    return (
      <Sheet>
        <h3>{prompt.label}</h3>
        <p>{prompt.details}</p>
        <div className="actions">
          <button onClick={() => send({ ...base, iterations: 0 })}>Stop here</button>
          <button onClick={() => send({ ...base, iterations: 1 })}>Once more</button>
        </div>
      </Sheet>
    );
  }

  const toggle = (id: string) => {
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      if (p.length >= prompt.maxSelections) return prompt.maxSelections === 1 ? [id] : p;
      return [...p, id];
    });
  };

  const thumb = (o: PromptState["options"][number]) => {
    const inst = o.targetId ? state.cards[o.targetId] : null;
    return inst ? <img src={cardImage(inst.cardId)} alt="" /> : null;
  };

  const b = state.battle;
  return (
    <Sheet wide>
      <h3>{prompt.label}</h3>
      {b && (
        <p className="battle-line">
          {instanceName(state, b.attackerId)} {b.attackPower} ⚔ {instanceName(state, b.targetId)} {b.defensePower + (b.powerCompared ? 0 : b.counterTotal)}
        </p>
      )}
      {prompt.details && <p className="hint">{prompt.details}</p>}
      {multi ? (
        <>
          <div className="options">
            {prompt.options.map((o) => (
              <button
                key={o.id}
                className={`opt ${picked.includes(o.id) ? "on" : ""}`}
                disabled={o.enabled === false}
                onClick={() => toggle(o.id)}
              >
                {thumb(o)}
                <span>{o.label}</span>
              </button>
            ))}
          </div>
          <div className="actions">
            <button
              disabled={picked.length < prompt.minSelections}
              onClick={() => send({ ...base, selectedIds: picked })}
            >
              {picked.length === 0 ? "Pass" : `Confirm ${picked.length}/${prompt.maxSelections}`}
            </button>
            {prompt.minSelections === 0 && picked.length > 0 && (
              <button className="ghost" onClick={() => setPicked([])}>Clear</button>
            )}
          </div>
        </>
      ) : (
        <div className="options">
          {prompt.options.map((o) => (
            <button
              key={o.id}
              className="opt"
              disabled={o.enabled === false}
              onClick={() => send({ ...base, optionId: o.id })}
            >
              {thumb(o)}
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function SetupSheet({
  legal,
  send,
  hand,
  onPeek,
  mulliganed,
  oppName,
}: {
  legal: LegalCommandDescriptor[];
  send: (c: EngineCommand) => void;
  hand: ProjectedCard[];
  onPeek: (i: number) => void;
  // there is only one mulligan, and the new hand is kept without asking
  mulliganed: boolean;
  oppName: string;
}) {
  const cmds = legal.filter((c) => c.type !== "concede");
  if (!cmds.length) {
    return (
      <div className="banner">Waiting for {oppName}…</div>
    );
  }
  const title =
    cmds[0].type === "chooseJoKenPo"
      ? "Rock-Paper-Scissors decides who picks first"
      : cmds[0].type === "chooseFirstPlayer"
        ? "You won Rock-Paper-Scissors"
        : cmds[0].type === "startGame"
          ? mulliganed ? "Your new hand" : "Ready"
          : "Keep this hand?";
  const hint =
    cmds[0].type === "startGame" && mulliganed
      ? "You get one mulligan per game, so this hand is kept."
      : cmds.some((c) => c.type === "mulligan")
        ? "You can mulligan once: shuffle these back and draw 5 new cards."
        : null;
  // the opening hand is the whole question, so it sits in the sheet at full size
  const keeping = hand.length > 0 && cmds.some((c) => c.type === "keepHand" || c.type === "startGame");
  return (
    <div className={`setup ${keeping ? "keep" : ""}`}>
      <h3>{title}</h3>
      {hint && <p className="hint">{hint}</p>}
      {keeping && (
        <div className="opening">
          {hand.map((c, i) => (
            <img key={c.instanceId ?? i} src={cardImage(c.cardId!)} alt={cardName(c.cardId!)} draggable={false} onClick={() => onPeek(i)} />
          ))}
        </div>
      )}
      <div className="actions">
        {cmds.map((c, i) => (
          <button key={i} onClick={() => send(commandFor(c))}>
            {setupLabel(c)}
          </button>
        ))}
      </div>
    </div>
  );
}

function setupLabel(c: LegalCommandDescriptor): string {
  switch (c.type) {
    case "chooseJoKenPo": {
      const v = String(c.options![0].value);
      return v[0].toUpperCase() + v.slice(1);
    }
    case "chooseFirstPlayer":
      return c.targetIds![0] === ME ? "Go first" : "Go second";
    case "mulligan":
      return "Mulligan";
    case "keepHand":
      return "Keep hand";
    case "startGame":
      return "Start";
    default:
      return c.label;
  }
}

function commandFor(c: LegalCommandDescriptor): EngineCommand {
  switch (c.type) {
    case "chooseJoKenPo":
      return { type: "chooseJoKenPo", seat: ME, choice: c.options![0].value as "rock" | "paper" | "scissors" };
    case "chooseFirstPlayer":
      return { type: "chooseFirstPlayer", seat: ME, firstPlayer: c.targetIds![0] as "north" | "south" };
    case "mulligan":
      return { type: "mulligan", seat: ME };
    case "keepHand":
      return { type: "keepHand", seat: ME };
    case "startGame":
      return { type: "startGame", seat: ME };
    default:
      return { type: "endTurn", seat: ME };
  }
}

const HOW: Record<string, string> = {
  leaderDamage: "The final hit landed on a Leader with no Life left.",
  emptyDeck: "A deck ran out of cards.",
  concession: "Conceded.",
  effectWin: "A card effect decided it.",
  judgeDecision: "Decided by a judge.",
};

export function GameOver({
  state,
  oppName,
  onQuit,
  onRematch,
  rematchFrom,
}: {
  state: MatchState;
  oppName: string;
  onQuit: () => void;
  // only an online table can offer another go
  onRematch?: () => void;
  rematchFrom?: MatchSeat | null;
}) {
  const [asked, setAsked] = useState(false);
  const won = state.winner === ME;
  const theyAsked = !!rematchFrom && rematchFrom !== ME;
  return (
    <Sheet>
      <h3>{state.winner === null ? "Draw" : won ? "You win" : `${oppName} wins`}</h3>
      <p className="hint">{theyAsked ? `${oppName} wants a rematch` : HOW[state.finishReason ?? ""] ?? ""}</p>
      <div className="actions">
        <button className="ghost" onClick={onQuit}>Back to menu</button>
        {onRematch && (
          <button
            disabled={asked && !theyAsked}
            onClick={() => {
              setAsked(true);
              onRematch();
            }}
          >
            {theyAsked ? "Accept rematch" : asked ? "Waiting for them…" : "Rematch"}
          </button>
        )}
      </div>
    </Sheet>
  );
}
