import { useEffect, useRef, useState } from "react";
import type { User } from "./auth";
import { ago, loadOlder, markRead, sendMessage, useMessages, type Friend, type Message } from "./social";

export function Chat({ me, friend, onBack }: { me: User; friend: Friend; onBack: () => void }) {
  const live = useMessages(me.uid, friend.uid);
  const [older, setOlder] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [more, setMore] = useState(true);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    markRead(me.uid, friend.uid);
  }, [me.uid, friend.uid, live.length]);
  useEffect(() => {
    body.current?.scrollTo(0, body.current.scrollHeight);
  }, [live.length]);

  const all = [...older, ...live];
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    sendMessage({ uid: me.uid, name: me.username ?? "?" }, friend, t);
  };

  return (
    <div className="menu chat">
      <h1>{friend.name}</h1>
      <div className="chat-body" ref={body}>
        {more && all.length >= 30 && (
          <button
            className="ghost small"
            onClick={() =>
              loadOlder(me.uid, friend.uid, all[0].at).then((m) => {
                setOlder((o) => [...m, ...o]);
                if (m.length < 30) setMore(false);
              })
            }
          >
            Load earlier
          </button>
        )}
        {all.map((m) => (
          <div key={m.id} className={`msg ${m.from === me.uid ? "mine" : ""}`}>
            <span>{m.text}</span>
            <small>{ago(m.at)}</small>
          </div>
        ))}
      </div>
      <div className="join">
        <input value={text} maxLength={500} placeholder="Message" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <button disabled={!text.trim()} onClick={send}>Send</button>
      </div>
      <button className="ghost" onClick={onBack}>Back</button>
    </div>
  );
}
