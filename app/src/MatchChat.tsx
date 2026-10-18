import { useEffect, useRef, useState } from "react";
import type { MatchSeat } from "@tcg/op-engine";
import type { Table } from "./match";

export const EMOTES: Record<string, string> = { gg: "GG", nice: "Nice!", think: "Hmm…", oops: "Oops", hurry: "Hurry up", wow: "Wow" };

export type Said = { from: MatchSeat; text: string; at: number };

// the chat corner of an online game: a row of emotes, a drawer for words, and whatever the
// other side just said floating over their mat
export function MatchChat({
  chat,
  me,
  oppName,
  messages,
  emote,
}: {
  chat: NonNullable<Table["chat"]>;
  me: MatchSeat;
  oppName: string;
  messages: Said[];
  emote: { from: MatchSeat; id: string; at: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [flash, setFlash] = useState<Said | null>(null);
  const seen = useRef(messages.length);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fresh = messages.slice(seen.current);
    seen.current = messages.length;
    const theirs = fresh.filter((m) => m.from !== me).pop();
    if (theirs && !open) {
      setFlash(theirs);
      const t = setTimeout(() => setFlash(null), 3500);
      return () => clearTimeout(t);
    }
  }, [messages.length]);
  useEffect(() => {
    body.current?.scrollTo(0, body.current.scrollHeight);
  }, [messages.length, open]);

  const bubble = emote && Date.now() - emote.at < 2500 ? emote : null;
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    chat.say(t);
  };

  return (
    <>
      {bubble && (
        <div className={`bubble ${bubble.from === me ? "mine" : ""}`} key={bubble.at}>
          {EMOTES[bubble.id] ?? bubble.id}
        </div>
      )}
      {flash && <div className="toast chat-flash" onClick={() => setOpen(true)}>{oppName}: {flash.text}</div>}
      <div className="emotes">
        {Object.entries(EMOTES).map(([id, label]) => (
          <button key={id} className="small" onClick={() => chat.emote(id)}>
            {label}
          </button>
        ))}
        <button className="small ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide chat" : "Chat"}
        </button>
      </div>
      {open && (
        <div className="chat-drawer">
          <div className="chat-body" ref={body}>
            {messages.map((m) => (
              <div key={m.at + m.from} className={`msg ${m.from === me ? "mine" : ""}`}>
                <span>{m.text}</span>
              </div>
            ))}
          </div>
          <div className="join">
            <input value={text} maxLength={300} placeholder="Say something" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
            <button className="small" disabled={!text.trim()} onClick={send}>Send</button>
          </div>
        </div>
      )}
    </>
  );
}
