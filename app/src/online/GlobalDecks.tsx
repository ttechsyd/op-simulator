import { useEffect, useState } from "react";
import { getCard } from "@tcg/op-cards";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import type { User } from "./auth";
import { browse, copyToMine, toggleLike, unshare, type Shared } from "./library";
import { leaders } from "../decks";
import { cardImage } from "../cards";

const byName = [...leaders].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

export function GlobalDecks({ user, onBack, onCopied }: { user: User | null; onBack: () => void; onCopied: () => void }) {
  const [leader, setLeader] = useState("");
  const [q, setQ] = useState("");
  const [decks, setDecks] = useState<Shared[]>([]);
  const [last, setLast] = useState<QueryDocumentSnapshot | null>(null);
  const [open, setOpen] = useState<Shared | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = (more = false) =>
    browse({ leader: leader || undefined, q, after: more ? last : null }).then((r) => {
      setDecks((d) => (more ? [...d, ...r.decks] : r.decks));
      setLast(r.last);
    });
  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [leader, q]);

  const say = (t: string) => {
    setNote(t);
    setTimeout(() => setNote(null), 2500);
  };

  if (open) {
    const rows = Object.entries(open.cards).map(([id, n]) => ({ card: getCard(id), n }));
    return (
      <div className="menu library">
        <h1>{open.name}</h1>
        <p className="hint">
          {getCard(open.leader).name} · by {open.authorName} · ♥ {open.likes} · copied {open.copies}×
        </p>
        <div className="list cards">
          {rows.map(({ card, n }) => (
            <div className="friend" key={card.id}>
              <img src={cardImage(card.id)} alt="" />
              <span>
                <b>{card.name}</b>
                <small>{card.id}</small>
              </span>
              <span className="n">×{n}</span>
            </div>
          ))}
        </div>
        {note && <p className="hint">{note}</p>}
        <div className="actions">
          <button
            onClick={() =>
              copyToMine(open).then(() => {
                say("Copied to your decks");
                onCopied();
              })
            }
          >
            Copy to my decks
          </button>
          {user && (
            <button className="ghost" onClick={() => toggleLike(user.uid, open).then((liked) => setOpen({ ...open, likes: open.likes + (liked ? 1 : -1) }))}>
              ♥ Like
            </button>
          )}
          {user?.uid === open.author && (
            <button className="ghost" onClick={() => { if (confirm("Remove this deck from the library?")) unshare(open.id).then(() => { setOpen(null); load(); }); }}>
              Remove
            </button>
          )}
          <button className="ghost" onClick={() => setOpen(null)}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="menu library">
      <h1>Global Decks</h1>
      <div className="join">
        <select value={leader} onChange={(e) => setLeader(e.target.value)}>
          <option value="">Any leader</option>
          {byName.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.id})
            </option>
          ))}
        </select>
        <input value={q} placeholder="Search by name" onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="list">
        {decks.length === 0 ? (
          <p className="hint">Nothing shared yet. Open one of your decks and tap Share.</p>
        ) : (
          decks.map((d) => (
            <div className="friend" key={d.id} onClick={() => setOpen(d)}>
              <img src={cardImage(d.leader)} alt="" />
              <span>
                <b>{d.name}</b>
                <small>
                  {getCard(d.leader).name} · {d.authorName} · ♥ {d.likes} · {d.copies}×
                </small>
              </span>
            </div>
          ))
        )}
        {last && decks.length >= 20 && <button className="ghost small" onClick={() => load(true)}>More</button>}
      </div>
      <button className="ghost" onClick={onBack}>Back</button>
    </div>
  );
}
