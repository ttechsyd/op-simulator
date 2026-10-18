import { useEffect, useState } from "react";
import type { User } from "./auth";
import {
  acceptRequest,
  ago,
  api,
  declineRequest,
  findUser,
  loadFriends,
  removeFriend,
  sendRequest,
  useInbox,
  usePresence,
  useRequests,
  type Friend,
} from "./social";

export function Friends({
  user,
  onBack,
  onChat,
  onInvite,
}: {
  user: User;
  onBack: () => void;
  onChat?: (f: Friend) => void;
  onInvite?: (f: Friend) => void;
}) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [add, setAdd] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const requests = useRequests(user.uid);
  const inbox = useInbox(user.uid);
  const presence = usePresence(friends?.map((f) => f.uid) ?? []);

  const refresh = () => loadFriends(user.uid).then(setFriends);
  useEffect(() => {
    refresh();
  }, [user.uid, requests.length]);

  const say = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(null), 3000);
  };

  const sendAdd = async () => {
    const who = await findUser(add);
    if (!who) return say("No player with that name");
    if (who.uid === user.uid) return say("That's you");
    await sendRequest({ uid: user.uid, name: user.username ?? "?" }, who);
    setAdd("");
    say(`Request sent to ${who.name}`);
  };

  const nudge = async (f: Friend) => {
    const r = await api("/nudge", { to: f.uid });
    say(r.ok ? `Nudged ${f.name}` : r.error);
  };

  return (
    <div className="menu friends">
      <h1>Friends</h1>
      {note && <p className="hint">{note}</p>}

      {inbox.items.length > 0 && (
        <div className="list">
          {inbox.items.map((i) => (
            <div className="friend" key={i.id}>
              <span>
                <b>{i.fromName}</b> {i.kind === "invite" ? `invited you · room ${i.code}` : "wants to play"} <small>{ago(i.at)}</small>
              </span>
              <button className="small ghost" onClick={() => inbox.clear(i.id)}>Clear</button>
            </div>
          ))}
        </div>
      )}

      {requests.length > 0 && (
        <div className="list">
          {requests.map((r) => (
            <div className="friend" key={r.id}>
              <span>
                <b>{r.fromName}</b> wants to be friends
              </span>
              <button className="small" onClick={() => acceptRequest(r).then(refresh)}>Accept</button>
              <button className="small ghost" onClick={() => declineRequest(r)}>No</button>
            </div>
          ))}
        </div>
      )}

      <div className="list">
        {friends === null ? (
          <p className="hint">Loading…</p>
        ) : friends.length === 0 ? (
          <p className="hint">No friends yet. Add one by username below.</p>
        ) : (
          friends.map((f) => {
            const p = presence[f.uid];
            return (
              <div className="friend" key={f.uid}>
                <span className={`dot ${p?.online ? "on" : ""}`} />
                <span>
                  <b>{f.name}</b>
                  <small>{p?.online ? "online" : `last online ${ago(p?.lastOnline ?? 0)}`}</small>
                </span>
                <button className="small" onClick={() => nudge(f)}>Nudge</button>
                {onChat && <button className="small" onClick={() => onChat(f)}>Message</button>}
                {onInvite && <button className="small" onClick={() => onInvite(f)}>Invite</button>}
                <button className="small ghost" onClick={() => { if (confirm(`Remove ${f.name}?`)) removeFriend(user.uid, f.uid).then(refresh); }}>✕</button>
              </div>
            );
          })
        )}
      </div>

      <div className="join">
        <input value={add} maxLength={16} placeholder="username" onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendAdd()} />
        <button disabled={add.trim().length < 3} onClick={sendAdd}>Add</button>
      </div>
      <button className="ghost" onClick={onBack}>Back</button>
    </div>
  );
}
