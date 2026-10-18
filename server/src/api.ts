import type { IncomingMessage, ServerResponse } from "node:http";
import { areFriends, inbox, isOnline, live, profile, push, verify } from "./fire";

// What the app can't do straight against Firebase: anything that ends in a push. Every
// call carries the caller's Firebase ID token, and every target has to be a friend.

export interface Rooms {
  // true for a room the caller made and is still waiting in
  invitable(code: string, uid: string): boolean;
}

const nudged = new Map<string, number>();
const NUDGE_GAP = 10 * 60_000;

const reply = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};

const readJson = (req: IncomingMessage) =>
  new Promise<any>((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(s || "{}"));
      } catch {
        resolve({});
      }
    });
  });

// true when the request was an API call and has been answered
export async function api(req: IncomingMessage, res: ServerResponse, rooms: Rooms): Promise<boolean> {
  const path = (req.url ?? "/").split("?")[0];
  if (!["/nudge", "/invite", "/dm"].includes(path)) return false;
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    });
    res.end();
    return true;
  }
  if (!live) {
    reply(res, 503, { error: "This server isn't connected to Firebase" });
    return true;
  }
  const me = await verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  if (!me) {
    reply(res, 401, { error: "Sign in first" });
    return true;
  }
  const body = await readJson(req);
  const to = String(body.to ?? "");
  if (!to || to === me || !(await areFriends(me, to))) {
    reply(res, 403, { error: "Not your friend" });
    return true;
  }
  const { username } = await profile(me);
  const fromName = username ?? "Someone";

  if (path === "/nudge") {
    const key = `${me}>${to}`;
    const last = nudged.get(key) ?? 0;
    if (Date.now() - last < NUDGE_GAP) {
      reply(res, 429, { error: "You nudged them a moment ago" });
      return true;
    }
    nudged.set(key, Date.now());
    await inbox(to, { kind: "nudge", from: me, fromName });
    const sent = await push(to, `${fromName} wants to play`, "Open OP Sim and say hi", { kind: "nudge", from: me });
    reply(res, 200, { sent });
  } else if (path === "/invite") {
    const code = String(body.code ?? "").toUpperCase();
    if (!rooms.invitable(code, me)) {
      reply(res, 404, { error: "That room isn't yours to invite to" });
      return true;
    }
    await inbox(to, { kind: "invite", from: me, fromName, code });
    const sent = await push(to, `${fromName} invited you to a game`, `Room ${code}`, { kind: "invite", from: me, code });
    reply(res, 200, { sent });
  } else if (path === "/dm") {
    // the message itself is already in Firestore; this only wakes a closed app
    const text = String(body.text ?? "").slice(0, 120);
    const sent = (await isOnline(to)) ? 0 : await push(to, fromName, text, { kind: "dm", from: me });
    reply(res, 200, { sent });
  }
  return true;
}
