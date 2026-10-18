import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { App as Native } from "@capacitor/app";
import {
  getLegalCommands,
  getPotentialCardCommands,
  projectStateForSeat,
  type MatchSeat,
  type MatchState,
  type ProjectedCard,
} from "@tcg/op-engine";
import { Hand, OppHand, Phases, Seat } from "./Board";
import { GameOver, PromptSheet, SetupSheet } from "./Overlays";
import { Preview } from "./Preview";
import { Tray, pickTargets, shownCard, trayMode } from "./Tray";
import { Log, battleNumbers, filler, logDetail, wording } from "./Log";
import { BattleArrow, useCardMotion } from "./anim";
import { useManualTurnStart } from "./turnStart";
import { DragLayer, settleLayout, useDrag, type DragSource, type Layout } from "./drag";
import { BOT, DECKS, ME, localTable, newMatch, pendingPrompt, seatToShow, sitAt, useMatch, type DeckId, type Mode, type Table } from "./match";
import type { Level } from "./bot";
import { quietEndEffects, wastedUse } from "./skips";
import { Lobby } from "./Lobby";
import { forgetRoom } from "./net";
import { cardCounter, cardImage, cardName, skillWantsDon, timingName } from "./cards";
import { Builder, DeckList, DeckView } from "./Builder";
import { deleteDeck, loadDecks, newDeck, purgeUnverifiedArt, type Deck } from "./decks";
import { appReady, applyUpdate, bundleVersion, checkForUpdate, installApk, type Check } from "./update";
import { startPresence, useUser } from "./online/auth";
import { Account, UsernameSheet } from "./online/Gate";
import { configured } from "./online/firebase";
import { Friends } from "./online/Friends";
import { Chat } from "./online/Chat";
import { GlobalDecks } from "./online/GlobalDecks";
import { History } from "./online/History";
import { useInbox, useRequests, useUnread, type Friend } from "./online/social";
import { MatchChat } from "./MatchChat";
import { onForeground, registerPush, takeIntent } from "./online/push";

// ?seed=123&mine=red-aggro&theirs=st01 skips the menu, handy for replaying a hand
const params = new URLSearchParams(location.search);

export default function App() {
  const [mine, setMine] = useState<DeckId>(params.get("mine") ?? "pre:ST01");
  const [theirs, setTheirs] = useState<DeckId>(params.get("theirs") ?? "red-aggro");
  const [mode, setMode] = useState<Mode>(params.get("mode") === "self" ? "self" : params.get("mode") === "online" ? "online" : "bot");
  const [level, setLevel] = useState<Level>(() => (localStorage.getItem("opsim.level") === "hard" ? "hard" : "normal"));
  const pickLevel = (l: Level) => {
    setLevel(l);
    localStorage.setItem("opsim.level", l);
  };
  const [match, setMatch] = useState<{ table: Table; seat: MatchSeat } | null>(() =>
    params.has("seed") && mode !== "online"
      ? { table: localTable(newMatch(mine, theirs, mode, Number(params.get("seed"))), mode, level), seat: "south" }
      : null,
  );
  const [screen, setScreen] = useState<"menu" | "setup" | "decks" | "lobby" | "friends" | "library" | "history" | { view: Deck } | { edit: Deck } | { chat: Friend }>("menu");
  // an invite in hand: the code to walk into, or the friend to make a room for
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [inviteTo, setInviteTo] = useState<Friend | null>(null);
  const goOnline = (join: string | null, invite: Friend | null) => {
    setMode("online");
    setJoinCode(join);
    setInviteTo(invite);
    setScreen("setup");
  };
  const [saved, setSaved] = useState(loadDecks);
  const { user, named } = useUser();
  useEffect(() => (user?.uid ? startPresence(user.uid) : undefined), [user?.uid]);
  useEffect(() => {
    if (user?.username) registerPush(user.uid).catch(() => {});
  }, [user?.uid, user?.username]);
  const inbox = useInbox(user?.uid ?? null);
  const requests = useRequests(user?.uid ?? null);
  const unread = useUnread(user?.uid ?? null);
  const badge = inbox.items.length + requests.length + unread;
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    onForeground((i) => {
      setToast(`${i.title} · ${i.body}`);
      setTimeout(() => setToast(null), 3500);
    });
    // a tapped invite walks straight into the room; anything else lands on the friends screen
    const i = takeIntent();
    if (i?.kind === "invite" && i.code) goOnline(i.code, null);
    else if (i) setScreen("friends");
  }, []);
  const [check, setCheck] = useState<Check | "checking" | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [apkState, setApkState] = useState<"idle" | "downloading" | "installer">("idle");
  const release = check !== null && check !== "checking" && check.status === "update" ? check.release : null;
  const apkRelease = check !== null && check !== "checking" && check.status === "native" ? check.release : null;

  const lookForUpdate = () => {
    setCheck("checking");
    checkForUpdate().then(setCheck);
  };
  useEffect(() => {
    appReady();
    lookForUpdate();
    purgeUnverifiedArt();
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
  // every screen but the menu steps back a level; the running Game installs its own
  useEffect(() => {
    if (match || screen === "menu") return;
    onBack.current = () => {
      setScreen(screen === "lobby" ? "setup" : "menu");
      return true;
    };
    return () => {
      onBack.current = () => false;
    };
  }, [screen, match]);

  if (!match && screen === "lobby") {
    return (
      <Lobby
        deck={mine}
        username={user?.username}
        join={joinCode}
        inviteTo={inviteTo}
        onBack={() => { setJoinCode(null); setInviteTo(null); setScreen("setup"); }}
        onStart={(table, seat) => { setJoinCode(null); setInviteTo(null); setScreen("menu"); setMatch({ table, seat }); }}
      />
    );
  }
  if (!match && screen === "friends" && user) {
    return (
      <Friends
        user={user}
        onBack={() => setScreen("menu")}
        onChat={(f) => setScreen({ chat: f })}
        onInvite={(f) => goOnline(null, f)}
        onJoin={(code) => goOnline(code, null)}
      />
    );
  }
  if (!match && typeof screen === "object" && "chat" in screen && user) {
    return <Chat me={user} friend={screen.chat} onBack={() => setScreen("friends")} />;
  }
  if (!match && screen === "history" && user) {
    return <History user={user} onBack={() => setScreen("menu")} />;
  }
  if (!match && screen === "library") {
    return <GlobalDecks user={user ?? null} onBack={() => setScreen("menu")} onCopied={() => setSaved(loadDecks())} />;
  }
  if (!match && screen === "decks") {
    return (
      <DeckList
        decks={saved}
        onBack={() => setScreen("menu")}
        onNew={() => setScreen({ edit: newDeck() })}
        onOpen={(d) => setScreen({ view: d })}
        onEdit={(d) => setScreen({ edit: d })}
      />
    );
  }
  if (!match && typeof screen === "object" && "view" in screen) {
    return (
      <DeckView
        deck={screen.view}
        me={user?.username ? { uid: user.uid, name: user.username } : null}
        onBack={() => setScreen("decks")}
        onEdit={() => setScreen({ edit: screen.view })}
        onDelete={() => { deleteDeck(screen.view.id); setSaved(loadDecks()); setScreen("decks"); }}
      />
    );
  }
  if (!match && typeof screen === "object" && "edit" in screen) {
    const d = screen.edit;
    return <Builder initial={d} onDone={() => { const s = loadDecks(); setSaved(s); const kept = s.find((x) => x.id === d.id); setScreen(kept ? { view: kept } : "decks"); }} />;
  }
  if (!match) {
    const options = [...saved.map((d) => ({ id: `saved:${d.id}`, label: d.name })), ...DECKS];
    if (screen === "setup") {
      return (
        <div className="menu">
          <h1>{mode === "bot" ? "Player vs AI" : mode === "self" ? "Solo, both sides" : "Online with a friend"}</h1>
          <label>
            {mode === "self" ? "Player 1 deck" : "Your deck"}
            <select value={mine} onChange={(e) => setMine(e.target.value as DeckId)}>
              {options.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
          {mode !== "online" && (
            <label>
              {mode === "self" ? "Player 2 deck" : "AI deck"}
              <select value={theirs} onChange={(e) => setTheirs(e.target.value as DeckId)}>
                {options.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
          )}
          {mode === "bot" && (
            <label>
              Difficulty
              <div className="seg">
                <button className={level === "normal" ? "on" : ""} onClick={() => pickLevel("normal")}>Normal</button>
                <button className={level === "hard" ? "on" : ""} onClick={() => pickLevel("hard")}>Hard</button>
              </div>
            </label>
          )}
          {mode === "online" ? (
            <button onClick={() => setScreen("lobby")}>{joinCode ? `Join room ${joinCode}` : inviteTo ? `Invite ${inviteTo.name}` : "Find a game"}</button>
          ) : (
            <button onClick={() => setMatch({ table: localTable(newMatch(mine, theirs, mode), mode, level), seat: "south" })}>Play</button>
          )}
          <button className="ghost" onClick={() => setScreen("menu")}>Back</button>
        </div>
      );
    }
    const pick = (m: Mode) => {
      setMode(m);
      setScreen("setup");
    };
    return (
      <div className="home">
        <div className="home-side">
          <h1>OP Sim</h1>
          <Account user={user} badge={badge} onFriends={() => setScreen("friends")} />
          {user && !user.username && <UsernameSheet uid={user.uid} onDone={named} />}
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
                <small>
                  {updateError
                    ? `Failed: ${updateError}`
                    : apkState === "downloading"
                      ? "downloading, watch the notification"
                      : apkState === "installer"
                        ? "confirm the install when Android asks"
                        : "new native build · installs over this one"}
                </small>
              </span>
              <button
                className="small"
                disabled={apkState === "downloading"}
                onClick={() => {
                  setApkState("downloading");
                  setUpdateError(null);
                  installApk(apkRelease)
                    .then(() => setApkState("installer"))
                    .catch((e: Error) => {
                      setApkState("idle");
                      setUpdateError(e.message || "download failed");
                    });
                }}
              >
                {apkState === "installer" ? "Install again" : "Install update"}
              </button>
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
        <div className="home-main">
          <div className="tiles">
            <button className="tile" onClick={() => pick("bot")}>
              <i>⚔</i>
              Player vs AI
              <small>Normal or Hard bot</small>
            </button>
            <button className="tile" onClick={() => pick("self")}>
              <i>⇄</i>
              Solo, both sides
              <small>One phone, both seats</small>
            </button>
            <button className="tile" onClick={() => pick("online")}>
              <i>◎</i>
              Online
              <small>Room code or invite</small>
            </button>
          </div>
          <div className="shelf">
            <button onClick={() => setScreen("decks")}>Decks</button>
            {configured && <button onClick={() => setScreen("library")}>Global Decks</button>}
            {user?.username && (
              <button onClick={() => setScreen("friends")}>
                Friends {badge > 0 && <span className="badge">{badge}</span>}
              </button>
            )}
            {user?.username && <button onClick={() => setScreen("history")}>History</button>}
          </div>
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }
  return (
    <Game
      table={match.table}
      seat={match.seat}
      mode={mode}
      onQuit={() => {
        match.table.close();
        if (mode === "online") forgetRoom();
        setMatch(null);
      }}
      onBack={onBack}
    />
  );
}

function Game({
  table,
  seat: mySeat,
  mode,
  onQuit,
  onBack,
}: {
  table: Table;
  seat: MatchSeat;
  mode: Mode;
  onQuit: () => void;
  onBack: MutableRefObject<() => boolean>;
}) {
  const { state: real, send, error, undo, link, chat, messages, emote, rematchFrom } = useMatch(table);
  // playing both sides, the table turns to face whoever is up, behind a "pass the phone" screen
  const seat = mode === "self" ? seatToShow(real) : mySeat;
  sitAt(seat);
  const [turned, setTurned] = useState<{ seat: MatchSeat; pass: MatchSeat | null }>({ seat, pass: null });
  if (turned.seat !== seat) setTurned({ seat, pass: mode === "self" && real.status === "active" ? seat : null });
  // draw and DON!! wait for a tap; the engine has already done them underneath
  const { state, step, donLeft, draw, takeDon } = useManualTurnStart(real);
  const [preview, setPreview] = useState<{ group: ProjectedCard[]; start: number } | null>(null);
  // how the last battle went, shown for a moment where the readout was; a countered hit
  // otherwise just vanishes and looks like nothing happened
  const [after, setAfter] = useState<string | null>(null);
  const seenBattle = useRef(0);
  useEffect(() => {
    const ev = [...real.eventHistory].reverse().find((e) => e.type === "battleResolved");
    if (!ev || ev.sequence <= seenBattle.current) return;
    seenBattle.current = ev.sequence;
    const r = String(ev.payload.result);
    const a = ev.payload.attackPower;
    const d = ev.payload.defensePower;
    const mine = ev.sourceInstanceId ? real.cards[ev.sourceInstanceId]?.owner === ME : false;
    const text =
      r === "hit" ? `${mine ? "Hit" : "You take it"} · ${a} vs ${d}`
      : r === "ko" ? `K.O. · ${a} vs ${d}`
      : r === "blocked" ? `Blocked by ${cardName(real.cards[ev.targetIds[0]].cardId)} · ${a} vs ${d}`
      : `No damage · ${a} vs ${d}`;
    setAfter(text);
    const t = setTimeout(() => setAfter(null), 1800);
    return () => clearTimeout(t);
  }, [real.eventHistory]);

  // end-of-turn effects that never fired, said out loud once the turn has passed
  const [quiet, setQuiet] = useState<string[]>([]);
  const lastTurn = useRef({ turn: real.turnNumber, seat: real.activeSeat });
  useEffect(() => {
    const was = lastTurn.current;
    lastTurn.current = { turn: real.turnNumber, seat: real.activeSeat };
    if (real.turnNumber <= was.turn || !was.seat || (was.seat !== ME && mode !== "self")) return;
    const skipped = quietEndEffects(real, was.seat, was.turn);
    if (!skipped.length) return;
    setQuiet(skipped);
    const t = setTimeout(() => setQuiet([]), 3500);
    return () => clearTimeout(t);
  }, [real.turnNumber]);
  const [layout, setLayout] = useState<Layout>([null, null, null, null, null]);
  const [showLog, setShowLog] = useState(false);
  useCardMotion(state, seat);

  const view = useMemo(() => projectStateForSeat(state, ME), [state]);
  const prompt = pendingPrompt(state);
  const myPrompt = prompt?.seat === ME ? prompt : null;
  const tray = myPrompt ? trayMode(myPrompt) : null;
  // a life card with a trigger is offered in the readout over the seam, not a full-width tray
  const trigger = tray === "trigger" ? myPrompt : null;
  // yes/no, how-many and top-or-bottom questions fit in the readout; the sheet is for long lists
  const quick =
    myPrompt && !tray && ["confirm", "chooseOption", "chooseNumber"].includes(myPrompt.choiceKind ?? "") &&
    !myPrompt.options.some((o) => o.targetId) && myPrompt.options.length <= 8 && myPrompt.options.every((o) => o.label.length <= 16)
      ? myPrompt
      : null;
  // the real state, not the staged one: the dry run has to see the actual hand and life
  const wasted = useMemo(() => !!quick && wastedUse(real, quick), [quick?.id]);
  // a pick prompt can be answered on the table too: drag the card where the
  // effect sends it (trash, deck, life) or onto the tray itself
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setPicked([]), [myPrompt?.id]);
  const pickIds = useMemo(() => (tray === "pick" && myPrompt ? pickTargets(myPrompt) : new Set<string>()), [tray, myPrompt]);
  // when every choice is a card already on the table, the table is the picker and the
  // readout just keeps score; the tray is for cards you can't see otherwise
  const boardPick = useMemo(
    () => pickIds.size > 0 && [...pickIds].every((id) => ["leader", "character", "stage"].includes(state.cards[id]?.zone) || (state.cards[id]?.zone === "hand" && state.cards[id].owner === ME)),
    [pickIds, state],
  );
  const pick = (id: string) => {
    if (!myPrompt) return;
    const option = myPrompt.choiceKind === "chooseOption" ? myPrompt.options.find((o) => o.targetId === id) : null;
    if (option) {
      send({ type: "resolvePrompt", seat: ME, promptId: myPrompt.id, optionId: option.id });
      return;
    }
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
  const potential = useMemo(() => {
    if (!(myTurn && state.phase === "main")) return [];
    // the engine lets a "give a DON!!" skill fire with none to give, which burns its once per
    // turn for nothing; hold it back until there is one
    const p = state.players[ME];
    return getPotentialCardCommands(state, ME).map((a) => {
      if (a.type !== "activateEffect" || !a.enabled || !a.sourceId) return a;
      const wants = skillWantsDon(state.cards[a.sourceId].cardId);
      if (!wants || (wants === "rested" ? p.restedDon : p.activeDon) > 0) return a;
      return { ...a, enabled: false, disabledReason: `No ${wants} DON!! to give` };
    });
  }, [state, myTurn]);

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
  // mark the card being dragged; React leaves an attribute it doesn't know about alone
  const dragId = drag && (drag.source.kind === "hand" || drag.source.kind === "attacker") ? drag.source.card.instanceId : null;
  useEffect(() => {
    if (!dragId) return;
    const el = document.querySelector(`[data-id="${dragId}"]`);
    el?.setAttribute("data-dragging", "");
    return () => el?.removeAttribute("data-dragging");
  }, [dragId]);

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
  // every card wears what it can do right now, so nothing has to be tapped to find out
  const marks = useMemo(() => {
    const m = new Map<string, string[]>();
    const add = (id: string, mark: string) => m.set(id, [...(m.get(id) ?? []), mark]);
    for (const a of potential) {
      if (!a.enabled || !a.sourceId) continue;
      if (a.type === "playCard") add(a.sourceId, "PLAY");
      else if (a.type === "declareAttack" && a.targetIds?.length) add(a.sourceId, "ATK");
      else if (a.type === "activateEffect") add(a.sourceId, "SKILL");
    }
    if (battleStep === "block") for (const id of stepIds) add(id, "BLOCK");
    if (battleStep === "counter") for (const id of stepIds) add(id, `+${cardCounter(state.cards[id].cardId) ?? 0}`);
    return m;
  }, [potential, battleStep, stepIds, state]);

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

  const sourceFor = (c: ProjectedCard): DragSource => {
    if (battleStep && myPrompt && battle && c.instanceId && stepIds.has(c.instanceId))
      return {
        kind: "free",
        cardId: c.cardId!,
        targets: new Set([battleStep === "counter" ? `mine:${battle.targetId}` : `opp:${battle.attackerId}`]),
        drop: () => send({ type: "resolvePrompt", seat: ME, promptId: myPrompt.id, selectedIds: [c.instanceId!] }),
      };
    if (c.instanceId && pickIds.has(c.instanceId)) {
      const action = String(myPrompt!.context.action ?? "");
      const sink = /trash/i.test(action) ? "trash" : /deck/i.test(action) ? "deck" : /life/i.test(action) ? "life" : null;
      return { kind: "free", cardId: c.cardId!, targets: new Set(sink ? [sink, "tray"] : ["tray"]), drop: () => pick(c.instanceId!) };
    }
    if (c.owner === ME && c.zone === "hand") return { kind: "hand", card: c };
    if (c.owner === ME && (c.zone === "leader" || c.zone === "character")) return { kind: "attacker", card: c };
    return { kind: "look", card: c };
  };
  const pressCard = (e: ReactPointerEvent, c: ProjectedCard, group: ProjectedCard[], at?: () => ProjectedCard) => {
    if (c.hidden || !c.cardId) return;
    const now = () => at?.() ?? c;
    press(
      e,
      () => sourceFor(now()),
      () => {
        const card = now();
        // a card lit for a pick is picked by the tap itself; anything else opens to read
        if (card.instanceId && pickIds.has(card.instanceId) && !battleStep) pick(card.instanceId);
        else setPreview({ group, start: group.indexOf(card) });
      },
      !!at,
    );
  };
  const pressDon = (e: ReactPointerEvent) => press(e, { kind: "don" });
  // A skill that hands out DON!! asks twice: how many, then to whom. Dragging a rested
  // DON!! onto the card answers both; the second answer waits for the second question.
  const givingCount = quick?.resolutionContext?.intent === "effectGiveDonCount" ? quick : null;
  const givingDon = boardPick && myPrompt && /^giveDon$/i.test(String(myPrompt.context.action ?? ""));
  const giveTo = useRef<string | null>(null);
  const pressRestedDon = givingCount
    ? (e: ReactPointerEvent) =>
        press(e, {
          kind: "don",
          targets: new Set([me.leader, ...me.characters].flatMap((c) => (c?.instanceId ? [`mine:${c.instanceId}`] : []))),
          drop: (key) => {
            giveTo.current = key.slice(5);
            send({ type: "resolvePrompt", seat: ME, promptId: givingCount.id, optionId: "1" });
          },
        })
    : givingDon
      ? (e: ReactPointerEvent) =>
          press(e, { kind: "don", targets: new Set([...pickIds].map((id) => `mine:${id}`)), drop: (key) => pick(key.slice(5)) })
      : undefined;
  useEffect(() => {
    const to = giveTo.current;
    if (!to || !givingDon) return;
    giveTo.current = null;
    if (pickIds.has(to)) pick(to);
  }, [givingDon, myPrompt?.id]);

  // a small face in the readout that opens the card big enough to read
  const thumb = (id: string) => {
    const c = state.cards[id];
    const open = () =>
      setPreview({ group: [{ instanceId: c.instanceId, cardId: c.cardId, name: cardName(c.cardId), owner: c.owner, zone: c.zone, rested: false, attachedDon: 0, lifeValue: null, power: null, cost: null, attribute: null, hidden: false }], start: 0 });
    return <img className="thumb" src={cardImage(c.cardId)} alt="" onClick={open} />;
  };

  const actionsFor = (c: ProjectedCard) =>
    c.owner === ME && c.instanceId ? potential.filter((a) => a.sourceId === c.instanceId) : [];

  const drop = drag ? { ok: drag.targets, over: drag.over } : undefined;
  const endTurn = myTurn && legal.some((c) => c.type === "endTurn");
  const opp = view.players[BOT];
  // the corner strip: the last few real moves, newest first, with the numbers that matter
  const battles = useMemo(() => battleNumbers(state), [state.eventHistory]);
  const logs = view.logs.filter((l) => !filler(l.message)).slice(-3).reverse();

  // the whole table is drawn at 960x430 and scaled to whatever screen it lands on
  const tableRef = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = tableRef.current!;
    const fit = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setK(Math.min(w / 960, h / 430));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the hand sits under the bottom edge: lifted to read, half up when it has to answer a
  // battle step or a pick, tucked away while something else is being dragged
  const [handUp, setHandUp] = useState(false);
  const handPos = drag ? "tuck" : handUp ? "up" : battleStep || tray === "pick" ? "half" : "";

  // mirror matches put Luffy against Luffy, so then the readout says whose
  const fighter = (id: string) => {
    const c = state.cards[id];
    const n = cardName(c.cardId);
    const twin = battle && cardName(state.cards[battle.attackerId].cardId) === cardName(state.cards[battle.targetId].cardId);
    return twin ? `${c.owner === ME ? "Your" : `${opp.playerName}'s`} ${n}` : n;
  };
  const turnLabel =
    state.status === "setup" ? "Setup"
    : state.status === "finished" ? "Game over"
    : prompt && prompt.seat !== ME ? "Waiting for opponent"
    : state.activeSeat === ME ? "Your turn"
    : `${opp.playerName}'s turn`;

  return (
    <div className="table" ref={tableRef} style={{ "--k": k } as CSSProperties}>
      <div className="stage">
        <OppHand count={opp.handCount} />
        <Seat
          p={opp}
          opponent
          dealt={state.status !== "setup"}
          press={pressCard}
          drop={drop}
          litIds={new Set([...battleIds, ...pickIds])}
          onIds={new Set(picked)}
          corner={
            <>
              <div className="who">
                <b>{opp.playerName}</b> · {opp.handCount} in hand
                <button className="x" onClick={() => { if (confirm("Concede?")) send({ type: "concede", seat: ME }); }} aria-label="concede">✕</button>
              </div>
              <button className="loglines" onClick={() => setShowLog((v) => !v)}>
                {logs.map((l) => {
                  const extra = logDetail(l, state, battles);
                  return (
                    <span key={l.id}>
                      {wording(l.message)}
                      {extra && <small> {extra}</small>}
                    </span>
                  );
                })}
              </button>
            </>
          }
        />

        <Seat
          p={me}
          dealt={state.status !== "setup"}
          press={pressCard}
          pressDon={myTurn ? pressDon : undefined}
          pressRestedDon={pressRestedDon}
          drop={drop}
          litIds={new Set([...battleIds, ...canAct, ...stepIds, ...pickIds])}
          onIds={new Set(picked)}
          marks={marks}
          onDeck={step === "draw" ? draw : undefined}
          onDon={step === "don" ? takeDon : undefined}
          deckSplit={
            tray === "place" && myPrompt
              ? (half) => send({ type: "resolvePrompt", seat: ME, promptId: myPrompt.id, optionId: half })
              : undefined
          }
          corner={
            <>
              <div className="turn">{turnLabel}</div>
              <Phases current={state.status === "active" ? state.phase : null} />
            </>
          }
          actions={
            <>
              {undo && state.status === "active" && !step && <button className="ghost small" onClick={undo}>Undo</button>}
              {step === "draw" ? (
                <button className="end" onClick={draw}>Draw</button>
              ) : step === "don" ? (
                <button className="end" onClick={takeDon}>Take DON!! ({donLeft})</button>
              ) : (
                <button className="end" disabled={!endTurn} onClick={() => send({ type: "endTurn", seat: ME })}>End turn</button>
              )}
            </>
          }
        />

        <Hand
          cards={state.status === "setup" ? [] : view.players[ME].hand}
          press={pressCard}
          litIds={battleStep ? stepIds : tray === "pick" ? pickIds : canAct}
          onIds={new Set(picked)}
          dim={!!battleStep}
          marks={marks}
          pos={handPos}
          onLift={(v) => setHandUp((cur) => (v === "toggle" ? !cur : v))}
        />
      </div>

      {trigger ? (
        <div className="battle-bar">
          {thumb(shownCard(trigger, state))}
          <span>
            {cardName(state.cards[shownCard(trigger, state)].cardId)}
            <small> {trigger.resolutionContext?.intent === "lifeTrigger" ? "[Trigger]" : trigger.details}</small>
          </span>
          {trigger.options.map((o) => (
            <button key={o.id} className={o.id === "skip" ? "ghost" : ""} onClick={() => send({ type: "resolvePrompt", seat: ME, promptId: trigger.id, optionId: o.id })}>
              {o.id === "skip" ? "Skip" : o.id === "activate" ? "Use" : o.label}
            </button>
          ))}
        </div>
      ) : boardPick && myPrompt ? (
        <div className="battle-bar">
          <span>
            {myPrompt.sourceInstanceId && cardName(state.cards[myPrompt.sourceInstanceId].cardId)}
            <small>
              {" "}
              {myPrompt.resolutionContext?.intent === "playCharacterReplacement"
                ? "board full · trash 1"
                : givingDon
                  ? "drag a rested DON!! over, or tap the card"
                  : myPrompt.resolutionContext?.intent === "readyEffectOrder"
                    ? "which effect first? tap its card"
                  : (myPrompt.details || myPrompt.label).replace(/\.$/, "")}
            </small>
          </span>
          {myPrompt.maxSelections > 1 && <span className="hint">{picked.length}/{myPrompt.maxSelections}</span>}
          {myPrompt.maxSelections > 1 && picked.length > 0 && (
            <button className="ghost" onClick={() => setPicked([])}>Clear</button>
          )}
          {(myPrompt.maxSelections > 1 || myPrompt.minSelections === 0) && (
            <button
              disabled={picked.length < myPrompt.minSelections}
              onClick={() => send({ type: "resolvePrompt", seat: ME, promptId: myPrompt.id, selectedIds: picked })}
            >
              {picked.length === 0 ? (myPrompt.minSelections === 0 ? "None" : `Pick ${myPrompt.minSelections}`) : `Confirm ${picked.length}`}
            </button>
          )}
        </div>
      ) : quick && !battleStep ? (
        <div className="battle-bar">
          {quick.sourceInstanceId && thumb(quick.sourceInstanceId)}
          <span>
            {quick.sourceInstanceId && cardName(state.cards[quick.sourceInstanceId].cardId)}
            <small>
              {" "}
              {quick.resolutionContext?.intent === "effectOptional"
                ? `use [${timingName(String(quick.context.trigger))}]?${wasted ? " no target, it would do nothing" : ""}`
                : givingCount
                  ? "how many DON!!? or drag a rested one over"
                  : quick.details || quick.label}
            </small>
          </span>
          {quick.resolutionContext?.intent === "loopIterations" ? (
            <>
              <button className="ghost" onClick={() => send({ type: "resolvePrompt", seat: ME, promptId: quick.id, iterations: 0 })}>Stop here</button>
              <button onClick={() => send({ type: "resolvePrompt", seat: ME, promptId: quick.id, iterations: 1 })}>Once more</button>
            </>
          ) : (
            quick.options.map((o) => (
              <button
                key={o.id}
                className={/^(no|skip|cancel|pass|decline|none|0)$/i.test(o.id) || /^(no|skip|cancel|pass|decline)\b/i.test(o.label) ? "ghost" : ""}
                disabled={o.enabled === false || (wasted && o.id === "yes")}
                onClick={() => send({ type: "resolvePrompt", seat: ME, promptId: quick.id, optionId: o.id })}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      ) : battle ? (
        <div className="battle-bar">
          <span>
            {fighter(battle.attackerId)} {battle.attackPower} ⚔ {fighter(battle.targetId)} {defense}
            {battle.counterTotal > 0 && <small> (+{battle.counterTotal})</small>}
          </span>
          {battleStep && myPrompt ? (
            <>
              <span className="hint">
                {battleStep === "counter"
                  ? defense > battle.attackPower
                    ? "Holding"
                    : `Need +${battle.attackPower + 1000 - defense}`
                  : "Block?"}
                {battleStep === "counter" && stepIds.size === 0 && " · no counters"}
              </span>
              <button onClick={() => send({ type: "resolvePrompt", seat: ME, promptId: myPrompt.id, selectedIds: [] })}>
                {battleStep === "counter" ? (defense > battle.attackPower ? "Done" : "Take it") : "No block"}
              </button>
            </>
          ) : (
            prompt && prompt.seat !== ME && <span className="hint">Waiting…</span>
          )}
        </div>
      ) : after && !myPrompt ? (
        <div className="battle-bar after">
          <span>{after}</span>
        </div>
      ) : quiet.length && !myPrompt ? (
        <div className="battle-bar after long">
          <span>{quiet.join(" · ")}</span>
        </div>
      ) : null}
      <BattleArrow battle={battle} />
      <DragLayer drag={drag} />
      {showLog && (
        <Log
          logs={view.logs}
          state={state}
          onCard={(cardId, instanceId) => {
            const c = instanceId ? state.cards[instanceId] : null;
            setPreview({ group: [{ instanceId, cardId, name: cardName(cardId), owner: c?.owner ?? ME, zone: c?.zone ?? "hand", rested: false, attachedDon: 0, lifeValue: null, power: null, cost: null, attribute: null, hidden: false }], start: 0 });
          }}
          onClose={() => setShowLog(false)}
        />
      )}

      {state.status === "setup" && (
        <SetupSheet legal={legal} send={send} hand={view.players[ME].hand} mulliganed={state.setup.mulliganUsed[ME]} onPeek={(i) => setPreview({ group: view.players[ME].hand, start: i })} />
      )}
      {myPrompt && tray && !trigger && !boardPick && <Tray key={myPrompt.id} prompt={myPrompt} mode={tray} state={state} picked={picked} setPicked={setPicked} send={send} press={press} />}
      {myPrompt && !tray && !battleStep && !quick && <PromptSheet key={myPrompt.id} prompt={myPrompt} state={state} send={send} />}
      {preview && (!myPrompt || battleStep || trigger || quick) && (
        <Preview
          group={preview.group}
          start={preview.start}
          state={state}
          actionsFor={actionsFor}
          step={
            battleStep && myPrompt
              ? {
                  label: battleStep === "counter" ? "✚ Counter" : "⛨ Block",
                  ids: stepIds,
                  pick: (id) => send({ type: "resolvePrompt", seat: ME, promptId: myPrompt.id, selectedIds: [id] }),
                }
              : undefined
          }
          send={send}
          onClose={() => setPreview(null)}
        />
      )}
      {turned.pass && (
        <div className="pass" onClick={() => setTurned({ seat, pass: null })}>
          <h2>{real.players[turned.pass].playerName}</h2>
          <p>Pass the phone, then tap</p>
        </div>
      )}
      {chat && <MatchChat chat={chat} me={ME} oppName={opp.playerName} messages={messages} emote={emote} />}
      {state.status === "finished" && <GameOver state={state} oppName={opp.playerName} onQuit={onQuit} onRematch={chat?.rematch} rematchFrom={rematchFrom} />}
      {error && <div className="toast">{error}</div>}
      {link && (link.me !== "online" || !link.peer) && (
        <div className="toast link">{link.me !== "online" ? "Reconnecting…" : "Your opponent dropped off, waiting for them…"}</div>
      )}
    </div>
  );
}
