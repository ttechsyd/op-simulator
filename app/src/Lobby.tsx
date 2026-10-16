import { useEffect, useRef, useState } from "react";
import type { MatchSeat } from "@tcg/op-engine";
import { playerConfig, type DeckId, type Table } from "./match";
import { forgetRoom, openRoom, savedRoom, serverUrl, type Ask } from "./net";

type Status = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "waiting"; code: string } | { kind: "error"; text: string };

// make a room and read its code to a friend, or type theirs in
export function Lobby({ deck, onStart, onBack }: { deck: DeckId; onStart: (table: Table, seat: MatchSeat) => void; onBack: () => void }) {
  const [name, setName] = useState(() => localStorage.getItem("opsim.name") ?? "");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [server, setServer] = useState(serverUrl);
  const [showServer, setShowServer] = useState(false);
  const pending = useRef<Table | null>(null);
  const saved = savedRoom();

  useEffect(() => () => pending.current?.close(), []);

  const go = (ask: Ask) => {
    localStorage.setItem("opsim.name", name);
    localStorage.setItem("opsim.server", server);
    setStatus({ kind: "busy", text: "Connecting…" });
    let seat: MatchSeat = "south";
    pending.current = openRoom(ask, { name: name || "Player", deck: playerConfig(deck, name) }, {
      room: (r) => {
        seat = r.seat;
        setStatus({ kind: "waiting", code: r.code });
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
          <p className="hint">Tell your friend the room code</p>
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
          <label>
            Your name
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Player" />
          </label>
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
