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
import { Tray, trayMode } from "./Tray";
import { Log } from "./Log";
import { BattleArrow, useCardMotion } from "./anim";
import { DragLayer, settleLayout, useDrag, type DragSource, type Layout } from "./drag";
import { BOT, DECKS, ME, newMatch, pendingPrompt, useMatch, type DeckId } from "./match";
import { cardName } from "./cards";

// ?seed=123&mine=red-aggro&theirs=st01 skips the menu, handy for replaying a hand
const params = new URLSearchParams(location.search);

export default function App() {
  const [mine, setMine] = useState<DeckId>((params.get("mine") as DeckId) ?? "st01");
  const [theirs, setTheirs] = useState<DeckId>((params.get("theirs") as DeckId) ?? "red-aggro");
  const [match, setMatch] = useState<MatchState | null>(() =>
    params.has("seed") ? newMatch(mine, theirs, Number(params.get("seed"))) : null,
  );
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
  const { state, send, error, undo } = useMatch(initial);
  const [preview, setPreview] = useState<{ group: ProjectedCard[]; start: number } | null>(null);
  const [layout, setLayout] = useState<Layout>([null, null, null, null, null]);
  const [showLog, setShowLog] = useState(false);
  useCardMotion(state);

  const view = useMemo(() => projectStateForSeat(state, ME), [state]);
  const prompt = pendingPrompt(state);
  const myPrompt = prompt?.seat === ME ? prompt : null;
  const tray = myPrompt ? trayMode(myPrompt) : null;
  // blocker and counter steps play out on the board: drag the card onto the attacker or the defender
  const intent = myPrompt?.resolutionContext?.intent;
  const battleStep = intent === "battleCounter" ? "counter" : intent === "battleBlocker" ? "block" : null;
  const stepIds = useMemo(() => {
    const s = new Set<string>();
    if (battleStep && myPrompt) for (const o of myPrompt.options) if (o.targetId && o.enabled !== false) s.add(o.targetId);
    return s;
  }, [battleStep, myPrompt]);
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
      if (showLog) {
        setShowLog(false);
        return true;
      }
      if (myPrompt) return true;
      if (state.status === "finished" || confirm("Leave the match?")) onQuit();
      return true;
    };
    return () => {
      onBack.current = () => false;
    };
  }, [preview, showLog, myPrompt, state.status, onQuit, onBack]);

  const canAct = useMemo(() => {
    const s = new Set<string>();
    for (const a of potential) if (a.enabled && a.sourceId) s.add(a.sourceId);
    return s;
  }, [potential]);

  const battle = state.battle;
  // the engine only folds counters into defensePower when it compares, so add them while the step runs
  const defense = battle ? battle.defensePower + (battle.powerCompared ? 0 : battle.counterTotal) : 0;
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
    if (battleStep && myPrompt && battle && c.instanceId && stepIds.has(c.instanceId)) {
      source = {
        kind: "free",
        cardId: c.cardId,
        targets: new Set([battleStep === "counter" ? `mine:${battle.targetId}` : `opp:${battle.attackerId}`]),
        drop: () => send({ type: "resolvePrompt", seat: ME, promptId: myPrompt.id, selectedIds: [c.instanceId!] }),
      };
    } else if (c.owner === ME && c.zone === "hand") source = { kind: "hand", card: c };
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
            {cardName(state.cards[battle.targetId].cardId)} {defense}
          </span>
        ) : (
          <button className="logline" onClick={() => setShowLog((v) => !v)}>{lastLog?.message ?? "…"}</button>
        )}
      </div>

      <Seat
        p={me}
        phase={state.activeSeat === ME && state.status === "active" ? state.phase : null}
        press={pressCard}
        pressDon={myTurn ? pressDon : undefined}
        drop={drop}
        litIds={new Set([...battleIds, ...canAct, ...stepIds])}
        deckSplit={
          tray === "place" && myPrompt
            ? (half) => send({ type: "resolvePrompt", seat: ME, promptId: myPrompt.id, optionId: half })
            : undefined
        }
        corner={
          <>
            {undo && myTurn && <button className="ghost small" onClick={undo}>Undo DON</button>}
            {endTurn && <button className="end" onClick={() => send({ type: "endTurn", seat: ME })}>End turn</button>}
          </>
        }
      />
      <div className="hand-wrap">
        {myPrompt && battleStep && battle && (
          <div className="battle-bar">
            <span>
              {cardName(state.cards[battle.attackerId].cardId)} {battle.attackPower} ⚔ {cardName(state.cards[battle.targetId].cardId)} {defense}
              {battle.counterTotal > 0 && <small> (+{battle.counterTotal})</small>}
            </span>
            <span className="hint">
              {battleStep === "counter"
                ? stepIds.size ? "Drag a counter onto the defender" : "No counters in hand"
                : "Drag a blocker onto the attacker"}
            </span>
            <button onClick={() => send({ type: "resolvePrompt", seat: ME, promptId: myPrompt.id, selectedIds: [] })}>
              {battleStep === "counter" ? "No counter" : "No block"}
            </button>
          </div>
        )}
        <Hand cards={view.players[ME].hand} press={pressCard} litIds={battleStep ? stepIds : canAct} />
      </div>

      <BattleArrow battle={battle} />
      <DragLayer drag={drag} />
      {showLog && <Log logs={view.logs} onClose={() => setShowLog(false)} />}

      {state.status === "setup" && <SetupSheet legal={legal} send={send} />}
      {myPrompt && tray && <Tray key={myPrompt.id} prompt={myPrompt} mode={tray} state={state} send={send} press={press} />}
      {myPrompt && !tray && !battleStep && <PromptSheet key={myPrompt.id} prompt={myPrompt} state={state} send={send} />}
      {preview && (!myPrompt || battleStep) && (
        <Preview
          group={preview.group}
          start={preview.start}
          state={state}
          actionsFor={actionsFor}
          step={
            battleStep && myPrompt
              ? {
                  label: battleStep === "counter" ? "Use counter" : "Block with this",
                  ids: stepIds,
                  pick: (id) => send({ type: "resolvePrompt", seat: ME, promptId: myPrompt.id, selectedIds: [id] }),
                }
              : undefined
          }
          send={send}
          onClose={() => setPreview(null)}
        />
      )}
      {state.status === "finished" && <GameOver state={state} onQuit={onQuit} />}
      {error && <div className="toast">{error}</div>}
    </div>
  );
}
