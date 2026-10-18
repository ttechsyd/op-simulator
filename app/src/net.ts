import { applyPatches, enablePatches, type Patch } from "immer";
import type { EngineCommand, MatchPlayerConfig, MatchSeat, MatchState } from "@tcg/op-engine";
import type { Table, TableEvent } from "./match";
import { idToken } from "./online/auth";

enablePatches();

const params = new URLSearchParams(location.search);
const DEFAULT_SERVER = import.meta.env.DEV ? "ws://localhost:8787" : "wss://op-simulator.fly.dev";

export function serverUrl() {
  return params.get("server") ?? localStorage.getItem("opsim.server") ?? DEFAULT_SERVER;
}

export interface Room {
  code: string;
  seat: MatchSeat;
  token: string;
}

export interface Link {
  me: "connecting" | "online" | "reconnecting";
  peer: boolean;
}

export type Ask = { create: true } | { join: string } | { resume: Room };

// the room a phone was last in, so reopening the app can pick the seat back up
const SAVED = "opsim.room";
export function savedRoom(): Room | null {
  try {
    const r = JSON.parse(localStorage.getItem(SAVED) ?? "null");
    return r && Date.now() - r.at < 60 * 60_000 ? r : null;
  } catch {
    return null;
  }
}
export function forgetRoom() {
  localStorage.removeItem(SAVED);
}

// Opens the socket, asks for a room, and hands back a Table once the match exists. The
// socket is kept alive across drops: a phone that locks its screen comes back to the
// same seat with a resume. State arrives whole once, then as immer patches.
export function openRoom(
  ask: Ask,
  me: { name: string; deck: MatchPlayerConfig },
  on: { room(r: Room): void; start(table: Table): void; link(l: Link): void; error(message: string): void },
) {
  let ws: WebSocket | null = null;
  let room: Room | null = null;
  let state: MatchState | null = null;
  let v = 0;
  let closed = false;
  let retry = 0;
  const listeners = new Set<(ev: TableEvent) => void>();
  const link: Link = { me: "connecting", peer: false };
  let started = false;

  const emit = (ev: TableEvent) => listeners.forEach((fn) => fn(ev));
  const say = (msg: unknown) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  const setLink = (patch: Partial<Link>) => {
    Object.assign(link, patch);
    on.link({ ...link });
    emit({ kind: "link", ...link });
  };

  const table: Table = {
    get state() {
      return state!;
    },
    send(cmd: EngineCommand) {
      say({ t: "cmd", cmd });
    },
    chat: {
      say: (text) => say({ t: "chat", text }),
      emote: (id) => say({ t: "emote", id }),
      rematch: () => say({ t: "rematch" }),
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      closed = true;
      ws?.close();
      listeners.clear();
    },
  };

  const deck = { leader: me.deck.leaderCardId, cards: me.deck.mainDeck };

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(serverUrl());
    ws.onopen = async () => {
      retry = 0;
      // a signed-in player is known to the server by account, a guest by the seat token
      const auth = (await idToken()) ?? undefined;
      if (room) say({ t: "resume", code: room.code, token: room.token, auth });
      else if ("resume" in ask) say({ t: "resume", code: ask.resume.code, token: ask.resume.token, auth });
      else if ("join" in ask) say({ t: "join", code: ask.join, name: me.name, deck, auth });
      else say({ t: "create", name: me.name, deck, auth });
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "room") {
        room = { code: m.code, seat: m.seat, token: m.token ?? "" };
        localStorage.setItem(SAVED, JSON.stringify({ ...room, at: Date.now() }));
        on.room(room);
        setLink({ me: "online", peer: !!m.peer });
      } else if (m.t === "state") {
        state = m.state;
        v = m.v;
        if (!started) {
          started = true;
          on.start(table);
        } else emit({ kind: "changed" });
      } else if (m.t === "patch") {
        if (!state || m.v !== v + 1) {
          say({ t: "sync" });
          return;
        }
        state = applyPatches(state, m.patches as Patch[]);
        v = m.v;
        emit({ kind: "changed" });
      } else if (m.t === "rejected") {
        emit({ kind: "rejected", reason: m.reason });
      } else if (m.t === "chat") {
        emit({ kind: "chat", from: m.from, text: m.text, at: m.at });
      } else if (m.t === "emote") {
        emit({ kind: "emote", from: m.from, id: m.id, at: Date.now() });
      } else if (m.t === "rematch") {
        emit({ kind: "rematch", seat: m.seat });
      } else if (m.t === "peer") {
        setLink({ peer: m.online });
      } else if (m.t === "error") {
        on.error(m.message);
        closed = true;
        ws?.close();
      }
    };
    ws.onclose = () => {
      if (closed) return;
      // never got a seat: the server isn't there, say so instead of retrying forever
      if (!room) {
        closed = true;
        on.error(`Can't reach ${serverUrl()}`);
        return;
      }
      setLink({ me: "reconnecting" });
      setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++));
    };
    ws.onerror = () => ws?.close();
  };
  connect();
  return table;
}
