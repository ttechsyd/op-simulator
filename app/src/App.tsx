import { useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { App as Native } from "@capacitor/app";
import {
  getLegalCommands,
  getPotentialCardCommands,
  projectStateForSeat,
  type MatchState,
  type ProjectedCard,
} from "@tcg/op-engine";
import { Hand, Seat } from "./Board";
import { GameOver, PromptSheet, SetupSheet } from "./Overlays";
import { Preview } from "./Preview";
import { DragLayer, settleLayout, useDrag, type DragSource, type Layout } from "./drag";
import { BOT, DECKS, ME, newMatch, pendingPrompt, useMatch, type DeckId } from "./match";
import { cardName } from "./cards";

export default function App() {
  const [mine, setMine] = useState<DeckId>("st01");
  const [theirs, setTheirs] = useState<DeckId>("red-aggro");
  const [match, setMatch] = useState<MatchState | null>(null);
  // the running Game swaps in its own handler; false means "nothing to close, leave the app"
  const onBack = useRef<() => boolean>(() => false);

  useEffect(() => {
    const sub = Native.addListener("backButton", () => {
      if (!onBack.current()) Native.exitApp();
    });
    return () => {
      sub.then((s) => s.remove());
    };
  }, []);

  if (!match) {
    return (
      <div className="menu">
        <h1>OP Sim</h1>
        <label>
          Your deck
          <select value={mine} onChange={(e) => setMine(e.target.value as DeckId)}>
            {DECKS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <label>
          Bot deck
          <select value={theirs} onChange={(e) => setTheirs(e.target.value as DeckId)}>
            {DECKS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <button onClick={() => setMatch(newMatch(mine, theirs))}>Play</button>
      </div>
    );
  }
  return <Game initial={match} onQuit={() => setMatch(null)} onBack={onBack} />;
}

function Game({
  initial,
  onQuit,
  onBack,
}: {
  initial: MatchState;
  onQuit: () => void;
  onBack: MutableRefObject<() => boolean>;
}) {
  const { state, send, error } = useMatch(initial);
  const [preview, setPreview] = useState<{ group: ProjectedCard[]; start: number } | null>(null);
  const [layout, setLayout] = useState<Layout>([null, null, null, null, null]);

  const view = useMemo(() => projectStateForSeat(state, ME), [state]);
  const prompt = pendingPrompt(state);
  const myPrompt = prompt?.seat === ME ? prompt : null;
  const myTurn = state.status === "active" && state.activeSeat === ME && !prompt;
  const legal = useMemo(() => getLegalCommands(state, ME), [state]);
  const potential = useMemo(
    () => (myTurn && state.phase === "main" ? getPotentialCardCommands(state, ME) : []),
    [state, myTurn],
  );

  // my characters in the order I arranged them, not the engine's slot order
  const settled = useMemo(() => settleLayout(layout, view.players[ME].characters), [layout, view]);
  const me = useMemo(() => {
    const byId = new Map(view.players[ME].characters.map((c) => [c?.instanceId ?? "", c]));
    return { ...view.players[ME], characters: settled.map((id) => (id ? byId.get(id) ?? null : null)) };
  }, [settled, view]);

  const place = (id: string, at: number) =>
    setLayout((l) => {
      const cur = settleLayout(l, view.players[ME].characters);
      const from = cur.indexOf(id);
      const next = [...cur];
      next[at] = id;
      if (from !== -1) next[from] = cur[at];
      return next;
    });

  const { drag, press } = useDrag(potential, send, settled, place);

  useEffect(() => {
    onBack.current = () => {
      if (preview) {
        setPreview(null);
        return true;
      }
      if (myPrompt) return true;
      if (state.status === "finished" || confirm("Leave the match?")) onQuit();
      return true;
    };
    return () => {
      onBack.current = () => false;
    };
  }, [preview, myPrompt, state.status, onQuit, onBack]);

  const canAct = useMemo(() => {
    const s = new Set<string>();
    for (const a of potential) if (a.enabled && a.sourceId) s.add(a.sourceId);
    return s;
  }, [potential]);

  const battle = state.battle;
  const battleIds = useMemo(() => {
    const s = new Set<string>();
    if (battle) {
      s.add(battle.attackerId);
      s.add(battle.targetId);
      if (battle.blockerId) s.add(battle.blockerId);
    }
    return s;
  }, [battle]);

  const pressCard = (e: ReactPointerEvent, c: ProjectedCard, group: ProjectedCard[]) => {
    if (c.hidden || !c.cardId) return;
    const open = () => setPreview({ group, start: group.indexOf(c) });
    let source: DragSource = { kind: "look", card: c };
    if (c.owner === ME && c.zone === "hand") source = { kind: "hand", card: c };
    else if (c.owner === ME && (c.zone === "leader" || c.zone === "character")) source = { kind: "attacker", card: c };
    press(e, source, open);
  };
  const pressDon = (e: ReactPointerEvent) => press(e, { kind: "don" });

  const actionsFor = (c: ProjectedCard) =>
    c.owner === ME && c.instanceId ? potential.filter((a) => a.sourceId === c.instanceId) : [];

  const drop = drag ? { ok: drag.targets, over: drag.over } : undefined;
  const lastLog = view.logs[view.logs.length - 1];
  const endTurn = myTurn && legal.some((c) => c.type === "endTurn");

  return (
    <div className="table">
      <Seat
        p={view.players[BOT]}
        opponent
        phase={state.activeSeat === BOT && state.status === "active" ? state.phase : null}
        press={pressCard}
        drop={drop}
        litIds={battleIds}
        corner={
          <button className="ghost small" onClick={() => { if (confirm("Concede?")) send({ type: "concede", seat: ME }); }}>
            ✕
          </button>
        }
      />

      <div className="mid">
        {battle ? (
          <span className="battle">
            {cardName(state.cards[battle.attackerId].cardId)} {battle.attackPower} ⚔{" "}
            {cardName(state.cards[battle.targetId].cardId)} {battle.defensePower} · {battle.step}
          </span>
        ) : (
          <span className="logline">{lastLog?.message ?? ""}</span>
        )}
      </div>

      <Seat
        p={me}
        phase={state.activeSeat === ME && state.status === "active" ? state.phase : null}
        press={pressCard}
        pressDon={myTurn ? pressDon : undefined}
        drop={drop}
        litIds={new Set([...battleIds, ...canAct])}
        corner={endTurn ? <button className="end" onClick={() => send({ type: "endTurn", seat: ME })}>End turn</button> : null}
      />
      <Hand cards={view.players[ME].hand} press={pressCard} litIds={canAct} />

      <DragLayer drag={drag} />

      {state.status === "setup" && <SetupSheet legal={legal} send={send} />}
      {myPrompt && <PromptSheet key={myPrompt.id} prompt={myPrompt} state={state} send={send} />}
      {preview && !myPrompt && (
        <Preview
          group={preview.group}
          start={preview.start}
          state={state}
          actionsFor={actionsFor}
          send={send}
          onClose={() => setPreview(null)}
        />
      )}
      {state.status === "finished" && <GameOver state={state} onQuit={onQuit} />}
      {error && <div className="toast">{error}</div>}
    </div>
  );
}
