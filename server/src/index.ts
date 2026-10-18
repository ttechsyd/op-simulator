import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  applyCommand,
  createMatch,
  resolveBotPromptCommand,
  type EngineCommand,
  type MatchPlayerConfig,
  type MatchSeat,
  type MatchState,
} from "@tcg/op-engine";
import { hasCard } from "@tcg/op-cards";
import { api } from "./api";
import { live, profile, recordMatch, verify } from "./fire";

// One room per match, kept in memory. The creator sits south, the joiner north. Each
// player gets a token so a phone that drops its socket can pick the seat back up.

interface Player {
  name: string;
  deck: MatchPlayerConfig;
  // a signed-in player is known by uid; a guest only by the token handed out at the door
  uid: string | null;
  token: string;
  ws: WebSocket | null;
}

interface Room {
  code: string;
  players: Partial<Record<MatchSeat, Player>>;
  state: MatchState | null;
  // bumps on every state change so a client can tell when it missed one
  v: number;
  touched: number;
  // how many games this pair has played here; the first player alternates
  games: number;
  startedAt: number;
  recorded: boolean;
  rematch: Partial<Record<MatchSeat, true>>;
  lastChat: Partial<Record<MatchSeat, number>>;
}

const EMOTES = new Set(["gg", "nice", "think", "oops", "hurry", "wow"]);

const rooms = new Map<string, Room>();
const ROOM_IDLE_MS = 30 * 60_000;

function newCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  do code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  while (rooms.has(code));
  return code;
}

function deckOf(x: unknown): MatchPlayerConfig | null {
  if (!x || typeof x !== "object") return null;
  const d = x as { leader?: unknown; cards?: unknown };
  if (typeof d.leader !== "string" || !hasCard(d.leader)) return null;
  if (!Array.isArray(d.cards) || d.cards.length < 1 || d.cards.length > 60) return null;
  if (!d.cards.every((c) => typeof c === "string" && hasCard(c))) return null;
  return { leaderCardId: d.leader, mainDeck: d.cards as string[], donDeckCount: 10 };
}

const other = (seat: MatchSeat): MatchSeat => (seat === "south" ? "north" : "south");
const send = (ws: WebSocket | null, msg: unknown) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};
const tell = (room: Room, msg: unknown) => {
  for (const p of Object.values(room.players)) send(p.ws, msg);
};

function startMatch(room: Room) {
  const south = room.players.south!;
  const north = room.players.north!;
  room.games++;
  room.startedAt = Date.now();
  room.recorded = false;
  room.rematch = {};
  room.state = createMatch({
    firstPlayer: room.games % 2 ? "south" : "north",
    seed: Date.now() ^ (Math.random() * 0xffffffff),
    shuffleDecks: true,
    skipFirstTurnDraw: true,
    players: {
      south: { ...south.deck, playerName: south.name },
      north: { ...north.deck, playerName: north.name },
    },
  });
  settle(room);
  room.v++;
  tell(room, { t: "state", v: room.v, state: room.state });
}

// rules questions the engine asks of nobody in particular are answered here
function settle(room: Room) {
  const patches: unknown[] = [];
  for (;;) {
    const prompt = room.state!.promptQueue.find((p) => p.status === "pending");
    if (!prompt || prompt.kind !== "judge") break;
    const cmd = resolveBotPromptCommand(room.state!, prompt);
    if (!cmd) break;
    const r = applyCommand(room.state!, cmd);
    if (!r.accepted) break;
    room.state = r.state;
    patches.push(...r.patches);
  }
  return patches;
}

function play(room: Room, seat: MatchSeat, cmd: EngineCommand) {
  const me = room.players[seat]!;
  if (!room.state) return send(me.ws, { t: "rejected", reason: "The match hasn't started" });
  if (cmd.seat !== seat) return send(me.ws, { t: "rejected", reason: "That's not your seat" });
  const r = applyCommand(room.state, cmd);
  if (!r.accepted) return send(me.ws, { t: "rejected", reason: r.reason ?? "That move isn't allowed right now" });
  room.state = r.state;
  const patches = [...r.patches, ...settle(room)];
  room.v++;
  room.touched = Date.now();
  tell(room, { t: "patch", v: room.v, patches });
  if (room.state.status === "finished" && !room.recorded) {
    room.recorded = true;
    record(room);
  }
}

// two signed-in players get the result on their records; anyone else just played
function record(room: Room) {
  const { south, north } = room.players;
  const s = room.state!;
  if (!live || !south?.uid || !north?.uid || south.uid === north.uid) return;
  const uidOf = (seat: MatchSeat) => room.players[seat]!.uid!;
  recordMatch({
    id: `${room.code}-${room.startedAt}`,
    uids: [south.uid, north.uid],
    names: { [south.uid]: south.name, [north.uid]: north.name },
    leaders: { [south.uid]: south.deck.leaderCardId, [north.uid]: north.deck.leaderCardId },
    winner: s.winner ? uidOf(s.winner) : null,
    reason: s.finishReason ?? "",
    turns: s.turnNumber,
    startedAt: room.startedAt,
  }).catch((e) => console.error("record", e));
}

// a friend can only be invited into a room its creator is still waiting in
const invitable = (code: string, uid: string) => {
  const r = rooms.get(code);
  return !!r && r.players.south?.uid === uid && !r.players.north;
};

const http = createServer((req, res) => {
  api(req, res, { invitable })
    .then((handled) => {
      if (handled) return;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`ok, ${rooms.size} rooms`);
    })
    .catch((e) => {
      console.error(e);
      res.writeHead(500);
      res.end();
    });
});

// who is at the door: a verified account, or whatever name they typed
async function identify(m: { auth?: unknown; name?: unknown }, fallback: string) {
  const uid = typeof m.auth === "string" ? await verify(m.auth) : null;
  const username = uid ? (await profile(uid)).username : null;
  return { uid, name: (username ?? String(m.name || fallback)).slice(0, 20) };
}
const wss = new WebSocketServer({ server: http });

wss.on("connection", (ws) => {
  let room: Room | null = null;
  let seat: MatchSeat | null = null;

  const sit = (r: Room, s: MatchSeat) => {
    room = r;
    seat = s;
    const p = r.players[s]!;
    p.ws?.close();
    p.ws = ws;
    r.touched = Date.now();
    send(ws, { t: "room", code: r.code, seat: s, token: p.uid ? undefined : p.token, uid: p.uid ?? undefined, peer: !!r.players[other(s)]?.ws });
    send(r.players[other(s)]?.ws ?? null, { t: "peer", online: true });
  };

  ws.on("message", async (raw) => {
    let m: any;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.t === "create") {
      const deck = deckOf(m.deck);
      if (!deck) return send(ws, { t: "error", message: "That deck can't be used" });
      const r: Room = { code: newCode(), players: {}, state: null, v: 0, touched: Date.now(), games: 0, startedAt: 0, recorded: false, rematch: {}, lastChat: {} };
      r.players.south = { ...(await identify(m, "Player 1")), deck, token: randomBytes(12).toString("hex"), ws: null };
      rooms.set(r.code, r);
      sit(r, "south");
    } else if (m.t === "join") {
      const r = rooms.get(String(m.code ?? "").toUpperCase());
      if (!r) return send(ws, { t: "error", message: "No room with that code" });
      if (r.players.north) return send(ws, { t: "error", message: "That room is full" });
      const deck = deckOf(m.deck);
      if (!deck) return send(ws, { t: "error", message: "That deck can't be used" });
      r.players.north = { ...(await identify(m, "Player 2")), deck, token: randomBytes(12).toString("hex"), ws: null };
      sit(r, "north");
      startMatch(r);
    } else if (m.t === "resume") {
      const r = rooms.get(String(m.code ?? ""));
      const uid = typeof m.auth === "string" ? await verify(m.auth) : null;
      const s = (["south", "north"] as const).find((x) => {
        const p = r?.players[x];
        return !!p && ((uid && p.uid === uid) || (m.token && p.token === m.token));
      });
      if (!r || !s) return send(ws, { t: "error", message: "That room is gone" });
      sit(r, s);
      if (r.state) send(ws, { t: "state", v: r.v, state: r.state });
    } else if (m.t === "sync") {
      if (room && room.state) send(ws, { t: "state", v: room.v, state: room.state });
    } else if (m.t === "cmd") {
      if (room && seat) play(room, seat, m.cmd);
    } else if (m.t === "chat") {
      if (!room || !seat || typeof m.text !== "string") return;
      const now = Date.now();
      if (now - (room.lastChat[seat] ?? 0) < 1000) return;
      room.lastChat[seat] = now;
      tell(room, { t: "chat", from: seat, text: m.text.slice(0, 300), at: now });
    } else if (m.t === "emote") {
      if (room && seat && EMOTES.has(String(m.id))) tell(room, { t: "emote", from: seat, id: m.id });
    } else if (m.t === "rematch") {
      if (!room || !seat || room.state?.status !== "finished") return;
      room.rematch[seat] = true;
      tell(room, { t: "rematch", seat });
      if (room.rematch.south && room.rematch.north) startMatch(room);
    }
  });

  ws.on("close", () => {
    if (!room || !seat) return;
    const p = room.players[seat]!;
    if (p.ws === ws) {
      p.ws = null;
      send(room.players[other(seat)]?.ws ?? null, { t: "peer", online: false });
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const empty = Object.values(r.players).every((p) => !p.ws);
    if ((empty && now - r.touched > ROOM_IDLE_MS) || (r.state?.status === "finished" && now - r.touched > 5 * 60_000)) rooms.delete(code);
  }
}, 60_000);

const port = Number(process.env.PORT ?? 8787);
http.listen(port, () => console.log(`opsim server on :${port}`));
