import { useState, type ReactNode } from "react";
import type {
  EngineCommand,
  LegalCommandDescriptor,
  MatchState,
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

export function SetupSheet({ legal, send }: { legal: LegalCommandDescriptor[]; send: (c: EngineCommand) => void }) {
  const cmds = legal.filter((c) => c.type !== "concede");
  if (!cmds.length) {
    return (
      <div className="banner">Waiting for the bot…</div>
    );
  }
  const title =
    cmds[0].type === "chooseJoKenPo"
      ? "Rock, paper, scissors for first pick"
      : cmds[0].type === "chooseFirstPlayer"
        ? "You won the toss"
        : cmds[0].type === "startGame"
          ? "Ready"
          : "Keep this hand?";
  return (
    <div className="setup">
      <h3>{title}</h3>
      <div className="actions">
        {cmds.map((c, i) => (
          <button key={i} onClick={() => send(commandFor(c))}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
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

export function GameOver({ state, onQuit }: { state: MatchState; onQuit: () => void }) {
  const won = state.winner === ME;
  return (
    <Sheet>
      <h3>{won ? "You win" : "Bot wins"}</h3>
      <p className="hint">{state.finishReason ?? ""}</p>
      <div className="actions">
        <button onClick={onQuit}>Back to menu</button>
      </div>
    </Sheet>
  );
}
