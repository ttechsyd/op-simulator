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
import { Tray, pickTargets, trayMode } from "./Tray";
import { Log } from "./Log";
import { BattleArrow, useCardMotion } from "./anim";
import { DragLayer, settleLayout, useDrag, type DragSource, type Layout } from "./drag";
import { BOT, DECKS, ME, newMatch, pendingPrompt, useMatch, type DeckId } from "./match";
import { cardName } from "./cards";
import { Builder, DeckList } from "./Builder";
import { deleteDeck, loadDecks, newDeck, type Deck } from "./decks";
import { appReady, applyUpdate, bundleVersion, checkForUpdate, openApk, type Check } from "./update";

// ?seed=123&mine=red-aggro&theirs=st01 skips the menu, handy for replaying a hand
const params = new URLSearchParams(location.search);

export default function App() {
  const [mine, setMine] = useState<DeckId>(params.get("mine") ?? "pre:ST01");
  const [theirs, setTheirs] = useState<DeckId>(params.get("theirs") ?? "red-aggro");
  const [match, setMatch] = useState<MatchState | null>(() =>
    params.has("seed") ? newMatch(mine, theirs, Number(params.get("seed"))) : null,
  );
  const [screen, setScreen] = useState<"menu" | "decks" | Deck>("menu");
  const [saved, setSaved] = useState(loadDecks);
  const [check, setCheck] = useState<Check | "checking" | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const release = check !== null && check !== "checking" && check.status === "update" ? check.release : null;
  const apkRelease = check !== null && check !== "checking" && check.status === "native" ? check.release : null;

  const lookForUpdate = () => {
    setCheck("checking");
    checkForUpdate().then(setCheck);
  };
  useEffect(() => {
    appReady();
    lookForUpdate();
  }, []);
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

  if (!match && screen === "decks") {
    return (
      <DeckList
        decks={saved}
        onBack={() => setScreen("menu")}
        onNew={() => setScreen(newDeck())}
        onEdit={(d) => setScreen(d)}
        onDelete={(d) => { deleteDeck(d.id); setSaved(loadDecks()); }}
      />
    );
  }
  if (!match && typeof screen === "object") {
    return <Builder initial={screen} onDone={() => { setSaved(loadDecks()); setScreen("decks"); }} />;
  }
  if (!match) {
    const options = [...saved.map((d) => ({ id: `saved:${d.id}`, label: d.name })), ...DECKS];
    return (
      <div className="menu">
        <h1>OP Sim</h1>
        <label>
          Your deck
          <select value={mine} onChange={(e) => setMine(e.target.value as DeckId)}>
            {options.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <label>
          Bot deck
          <select value={theirs} onChange={(e) => setTheirs(e.target.value as DeckId)}>
            {options.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <button onClick={() => setMatch(newMatch(mine, theirs))}>Play</button>
        <button className="ghost" onClick={() => setScreen("decks")}>Decks</button>
        {release && (
          <div className="update">
            <span>
              Card update {release.version}
              <small>{updateError ? `Failed: ${updateError}` : `${release.cards} cards · engine ${release.engine}`}</small>
            </span>
            {pct === null ? (
              <button
                className="small"
                onClick={() => {
                  setPct(0);
                  setUpdateError(null);
                  applyUpdate(release, setPct).catch((e: Error) => {
                    setPct(null);
                    setUpdateError(e.message || "download failed");
                  });
                }}
              >
                Update
              </button>
            ) : (
              <span className="pct">{pct}%</span>
            )}
          </div>
        )}
        {apkRelease && (
          <div className="update">
            <span>
              App update {apkRelease.version}
              <small>new native build · installs over this one</small>
            </span>
            <button className="small" onClick={() => openApk(apkRelease)}>Download APK</button>
          </div>
        )}
        <small className="ver">
          build {bundleVersion} ·{" "}
          {check === "checking" ? (
            "checking…"
          ) : check?.status === "current" ? (
            <>up to date · <button className="link" onClick={lookForUpdate}>check again</button></>
          ) : check?.status === "unreachable" ? (
            <>couldn't reach GitHub · <button className="link" onClick={lookForUpdate}>retry</button></>
          ) : check?.status === "browser" ? (
            "updates only on the phone"
          ) : (
            <button className="link" onClick={lookForUpdate}>check for updates</button>
          )}
        </small>
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
  // a pick prompt can be answered on the table too: drag the card where the
  // effect sends it (trash, deck, life) or onto the tray itself
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setPicked([]), [myPrompt?.id]);
  const pickIds = useMemo(() => (tray === "pick" && myPrompt ? pickTargets(myPrompt) : new Set<string>()), [tray, myPrompt]);
  const pick = (id: string) => {
    if (!myPrompt) return;
    if (myPrompt.maxSelections === 1) send({ type: "resolvePrompt", seat: ME, promptId: myPrompt.id, selectedIds: [id] });
    else setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < myPrompt.maxSelections ? [...p, id] : p));
  };
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
    } else if (c.instanceId && pickIds.has(c.instanceId)) {
      const action = String(myPrompt!.context.action ?? "");
      const sink = /trash/i.test(action) ? "trash" : /deck/i.test(action) ? "deck" : /life/i.test(action) ? "life" : null;
      source = {
        kind: "free",
        cardId: c.cardId,
        targets: new Set(sink ? [sink, "tray"] : ["tray"]),
        drop: () => pick(c.instanceId!),
      };
      press(e, source, () => pick(c.instanceId!));
      return;
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
        {battle && (
          <span className="battle">
            {cardName(state.cards[battle.attackerId].cardId)} {battle.attackPower} ⚔{" "}
            {cardName(state.cards[battle.targetId].cardId)} {defense}
          </span>
        )}
        {prompt && prompt.seat !== ME ? (
          <span className="waiting">{battle && " · "}Waiting for opponent…</span>
        ) : (
          !battle && <button className="logline" onClick={() => setShowLog((v) => !v)}>{lastLog?.message ?? "…"}</button>
        )}
      </div>

      <Seat
        p={me}
        phase={state.activeSeat === ME && state.status === "active" ? state.phase : null}
        press={pressCard}
        pressDon={myTurn ? pressDon : undefined}
        drop={drop}
        litIds={new Set([...battleIds, ...canAct, ...stepIds, ...pickIds])}
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
        <Hand cards={view.players[ME].hand} press={pressCard} litIds={battleStep ? stepIds : tray === "pick" ? pickIds : canAct} />
      </div>

      <BattleArrow battle={battle} />
      <DragLayer drag={drag} />
      {showLog && <Log logs={view.logs} onClose={() => setShowLog(false)} />}

      {state.status === "setup" && <SetupSheet legal={legal} send={send} />}
      {myPrompt && tray && <Tray key={myPrompt.id} prompt={myPrompt} mode={tray} state={state} picked={picked} setPicked={setPicked} send={send} press={press} />}
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
