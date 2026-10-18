import { useEffect, useRef, useState } from "react";
import type { MatchSeat } from "@tcg/op-engine";
import { playerConfig, type DeckId, type Table } from "./match";
import { DEFAULT_SERVER, forgetRoom, openRoom, savedRoom, serverUrl, type Ask } from "./net";
import { api, type Friend } from "./online/social";

type Status = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "waiting"; code: string } | { kind: "error"; text: string };

// make a room and read its code to a friend, or type theirs in
export function Lobby({
  deck,
  username,
  join,
  inviteTo,
  onStart,
  onBack,
}: {
  deck: DeckId;
  username?: string | null;
  // walk straight into this room, or make one and send this friend the code
  join?: string | null;
  inviteTo?: Friend | null;
  onStart: (table: Table, seat: MatchSeat) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(() => localStorage.getItem("opsim.name") ?? "");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [server, setServer] = useState(serverUrl);
  const [showServer, setShowServer] = useState(false);
  const pending = useRef<Table | null>(null);
  const saved = savedRoom();

  useEffect(() => () => pending.current?.close(), []);
  useEffect(() => {
    if (join) go({ join });
    else if (inviteTo) go({ create: true });
  }, []);

  const go = (ask: Ask) => {
    localStorage.setItem("opsim.name", name);
    if (server === DEFAULT_SERVER) localStorage.removeItem("opsim.server");
    else localStorage.setItem("opsim.server", server);
    setStatus({ kind: "busy", text: "Connecting…" });
    let seat: MatchSeat = "south";
    const shown = username || name || "Player";
    pending.current = openRoom(ask, { name: shown, deck: playerConfig(deck, shown) }, {
      room: (r) => {
        seat = r.seat;
        setStatus({ kind: "waiting", code: r.code });
        if (inviteTo && "create" in ask) api("/invite", { to: inviteTo.uid, code: r.code }).then((x) => !x.ok && setStatus({ kind: "error", text: x.error }));
      },
      start: (table) => {
        pending.current = null;
        onStart(table, seat);
      },
      link: () => {},
      error: (text) => {
        forgetRoom();
        setStatus({ kind: "error", text });
      },
    });
  };

  const stop = () => {
    pending.current?.close();
    pending.current = null;
    setStatus({ kind: "idle" });
  };

  return (
    <div className="menu lobby">
      <h1>Play online</h1>
      {status.kind === "waiting" ? (
        <>
          <p className="hint">{inviteTo ? `${inviteTo.name} has been invited` : "Tell your friend the room code"}</p>
          <div className="code">{status.code}</div>
          <p className="hint">Waiting for them to join…</p>
          <button className="ghost" onClick={stop}>Cancel</button>
        </>
      ) : status.kind === "busy" ? (
        <>
          <p className="hint">{status.text}</p>
          <button className="ghost" onClick={stop}>Cancel</button>
        </>
      ) : (
        <>
          {username ? (
            <p className="hint">Playing as {username}</p>
          ) : (
            <label>
              Your name
              <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Player" />
            </label>
          )}
          {status.kind === "error" && <p className="hint bad">{status.text}</p>}
          {saved && <button onClick={() => go({ resume: saved })}>Rejoin room {saved.code}</button>}
          <button onClick={() => go({ create: true })}>Create a room</button>
          <div className="join">
            <input value={code} maxLength={4} placeholder="CODE" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button disabled={code.length < 4} onClick={() => go({ join: code })}>Join</button>
          </div>
          <button className="ghost" onClick={onBack}>Back</button>
          <small className="ver">
            {showServer ? (
              <input className="server" value={server} onChange={(e) => setServer(e.target.value)} />
            ) : (
              <button className="link" onClick={() => setShowServer(true)}>server: {server}</button>
            )}
          </small>
        </>
      )}
    </div>
  );
}
