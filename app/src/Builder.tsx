import { useEffect, useMemo, useRef, useState } from "react";
import type { OPCard } from "@tcg/op-types";
import { getCard } from "@tcg/op-cards";
import { cardImage } from "./cards";
import { allArtUrls, cachedArtCount, colorsOf, deckToText, retryArt, newDeck, parseDeckText, deckProblems, deckSize, downloadArt, leaders, mainCards, prefetchImages, saveDeck, type Deck } from "./decks";

const COLORS = ["red", "green", "blue", "purple", "black", "yellow"] as const;
const TYPES = ["character", "event", "stage"] as const;
const PAGE = 120;

function cost(c: OPCard) {
  return "cost" in c ? c.cost : null;
}

// paste a list in, or copy this deck out
function DeckText({ deck, onImport, onClose }: { deck: Deck | null; onImport: (text: string) => string | null; onClose: () => void }) {
  const [text, setText] = useState(() => (deck ? deckToText(deck) : ""));
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{deck ? "Import or export" : "Import a deck"}</h3>
        <p className="hint">One card per line, like 4xOP10-111. The leader goes in as 1x.</p>
        <textarea className="deck-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        {note && <p className="hint">{note}</p>}
        <div className="actions">
          <button onClick={() => { const r = onImport(text); if (r) setNote(r); }}>Import</button>
          {deck && (
            <button className="ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => setNote("Copied"))}>Copy</button>
          )}
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function applyText(text: string, into: Deck): { deck: Deck; note: string | null } {
  const r = parseDeckText(text);
  const deck = { ...into, leader: r.leader ?? into.leader, cards: r.cards };
  const n = deckSize(deck);
  const note = r.unknown.length ? `Skipped unknown cards: ${r.unknown.join(", ")}` : n === 0 ? "Nothing recognised" : null;
  return { deck, note };
}

export function Builder({ initial, onDone }: { initial: Deck; onDone: () => void }) {
  const [deck, setDeck] = useState(initial);
  const [picking, setPicking] = useState<"leader" | "cards">(initial.leader ? "cards" : "leader");
  const [q, setQ] = useState("");
  const [colors, setColors] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [costs, setCosts] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [zoom, setZoom] = useState<OPCard | null>(null);
  const [text, setText] = useState(false);

  const leader = deck.leader ? getCard(deck.leader) : null;
  const leaderColors = leader ? colorsOf(leader) : [];
  const size = deckSize(deck);
  const problems = useMemo(() => deckProblems(deck), [deck]);

  const results = useMemo(() => {
    const pool = picking === "leader" ? leaders : mainCards;
    const needle = q.trim().toLowerCase();
    // with no colour chips on, stay inside the leader's colours like a real deck would
    const want = colors.size ? colors : new Set(leaderColors);
    return pool.filter((c) => {
      if (picking === "cards" && want.size && !colorsOf(c).some((k) => want.has(k))) return false;
      if (types.size && !types.has(c.cardType)) return false;
      if (costs.size && !costs.has(cost(c) ?? -1)) return false;
      if (needle) {
        const hay = `${c.name} ${c.id} ${(c.traits ?? []).join(" ")} ${c.effect ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [picking, q, colors, types, costs, leaderColors.join()]);

  const toggle = <T,>(set: Set<T>, v: T, put: (s: Set<T>) => void) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    put(next);
    setLimit(PAGE);
  };

  const add = (id: string) =>
    setDeck((d) => {
      const n = d.cards[id] ?? 0;
      if (n >= 4 || deckSize(d) >= 50) return d;
      return { ...d, cards: { ...d.cards, [id]: n + 1 } };
    });
  const remove = (id: string) =>
    setDeck((d) => {
      const n = d.cards[id] ?? 0;
      const cards = { ...d.cards };
      if (n <= 1) delete cards[id];
      else cards[id] = n - 1;
      return { ...d, cards };
    });

  const save = () => {
    saveDeck(deck);
    prefetchImages(deck).catch(() => {});
    onDone();
  };

  const rows = useMemo(() => {
    const list = Object.entries(deck.cards).map(([id, n]) => ({ card: getCard(id), n }));
    list.sort((a, b) => a.card.cardType.localeCompare(b.card.cardType) || (cost(a.card) ?? 0) - (cost(b.card) ?? 0) || a.card.name.localeCompare(b.card.name));
    return list;
  }, [deck.cards]);

  return (
    <div className="builder">
      <div className="b-head">
        <button className="ghost small" onClick={onDone}>‹ Decks</button>
        <input className="b-name" value={deck.name} onChange={(e) => setDeck({ ...deck, name: e.target.value })} />
        <button className={`b-leader ${picking === "leader" ? "on" : ""}`} onClick={() => setPicking(picking === "leader" ? "cards" : "leader")}>
          {leader ? <img src={cardImage(leader.id)} alt="" /> : <span className="card slot" />}
          <span>{leader ? leader.name : "Pick a leader"}</span>
        </button>
        <span className={`b-count ${size === 50 ? "ok" : ""}`}>{size}/50</span>
        <span className="b-problems">{problems[0] ?? "Deck is legal"}</span>
        <button className="ghost small" onClick={() => setText(true)}>Import / Export</button>
        <button className="end" onClick={save}>Save</button>
      </div>

      {text && (
        <DeckText
          deck={deck}
          onClose={() => setText(false)}
          onImport={(t) => {
            const r = applyText(t, deck);
            setDeck(r.deck);
            if (r.deck.leader) setPicking("cards");
            if (!r.note) setText(false);
            return r.note;
          }}
        />
      )}

      <div className="b-browse">
        <div className="b-filters">
          <input placeholder="Search name, trait, text" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
          {COLORS.map((k) => (
            <button key={k} className={`chip ${k} ${colors.has(k) ? "on" : ""}`} onClick={() => toggle(colors, k, setColors)}>{k}</button>
          ))}
          {picking === "cards" && TYPES.map((k) => (
            <button key={k} className={`chip ${types.has(k) ? "on" : ""}`} onClick={() => toggle(types, k, setTypes)}>{k}</button>
          ))}
          {picking === "cards" && Array.from({ length: 11 }, (_, i) => (
            <button key={i} className={`chip ${costs.has(i) ? "on" : ""}`} onClick={() => toggle(costs, i, setCosts)}>{i}</button>
          ))}
          <span className="b-found">{results.length}</span>
        </div>
        <div className="b-grid">
          {results.slice(0, limit).map((c) => {
            const n = deck.cards[c.id] ?? 0;
            return (
              <div key={c.id} className={`b-card ${n ? "in" : ""}`}>
                <img src={cardImage(c.id)} alt={c.name} loading="lazy" draggable={false} onClick={() => setZoom(c)} onError={(e) => retryArt(e.currentTarget)} />
                {picking === "leader" ? (
                  <button className="b-add" onClick={() => { setDeck({ ...deck, leader: c.id }); setPicking("cards"); }}>Use</button>
                ) : (
                  <>
                    {n > 0 && <span className="b-n">{n}</span>}
                    <button className="b-add" onClick={() => add(c.id)}>+</button>
                  </>
                )}
              </div>
            );
          })}
          {results.length > limit && <button className="b-more" onClick={() => setLimit(limit + PAGE)}>Show more</button>}
        </div>
      </div>

      <div className="b-list">
        {rows.length === 0 && <p className="hint">Tap + on cards to add them. Four copies each, fifty in all.</p>}
        {rows.map(({ card, n }) => (
          <div key={card.id} className="b-row" onClick={() => setZoom(card)}>
            <b>{n}×</b>
            <span className="b-cost">{cost(card)}</span>
            <span className="b-rowname">{card.name}</span>
            <small>{card.id}</small>
            <button className="ghost small" onClick={(e) => { e.stopPropagation(); remove(card.id); }}>−</button>
          </div>
        ))}
      </div>

      {zoom && (
        <div className="preview" onClick={() => setZoom(null)}>
          <div className="pv-card" onClick={(e) => e.stopPropagation()}>
            <img src={cardImage(zoom.id)} alt={zoom.name} draggable={false} />
            <div className="pv-actions">
              {zoom.cardType === "leader" ? (
                <button onClick={() => { setDeck({ ...deck, leader: zoom.id }); setPicking("cards"); setZoom(null); }}>Use as leader</button>
              ) : (
                <>
                  <button className="ghost" onClick={() => remove(zoom.id)} disabled={!deck.cards[zoom.id]}>−</button>
                  <span className="pv-n">{deck.cards[zoom.id] ?? 0} in deck</span>
                  <button onClick={() => add(zoom.id)}>+</button>
                </>
              )}
            </div>
          </div>
          <button className="pv-close" onClick={() => setZoom(null)} aria-label="close">✕</button>
        </div>
      )}
    </div>
  );
}

// every card face, so decks build and games play with no signal; it's a few hundred MB
function ArtDownload() {
  const [have, setHave] = useState(0);
  const [total, setTotal] = useState(() => allArtUrls().length);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    cachedArtCount().then(setHave);
    return () => abort.current?.abort();
  }, []);

  const start = () => {
    abort.current = new AbortController();
    setRunning(true);
    downloadArt((done, all) => { setHave(done); setTotal(all); }, abort.current.signal).finally(() => setRunning(false));
  };
  const stop = () => abort.current?.abort();

  const pct = total ? Math.round((have / total) * 100) : 0;
  return (
    <div className="art-dl">
      <div className="art-bar"><div style={{ width: `${pct}%` }} /></div>
      <span>Card art offline: {have} / {total}{running ? " · downloading" : ""}</span>
      {running ? (
        <button className="ghost small" onClick={stop}>Stop</button>
      ) : (
        have < total && <button className="small" onClick={start}>Download all art</button>
      )}
    </div>
  );
}

export function DeckList({ decks, onEdit, onNew, onDelete, onBack }: {
  decks: Deck[];
  onEdit: (d: Deck) => void;
  onNew: () => void;
  onDelete: (d: Deck) => void;
  onBack: () => void;
}) {
  const [importing, setImporting] = useState(false);
  return (
    <div className="decklist">
      <div className="b-head">
        <button className="ghost small" onClick={onBack}>‹ Menu</button>
        <h2>Your decks</h2>
        <button className="ghost small" onClick={() => setImporting(true)}>Import</button>
        <button className="end" onClick={onNew}>New deck</button>
      </div>
      {importing && (
        <DeckText
          deck={null}
          onClose={() => setImporting(false)}
          onImport={(t) => {
            const r = applyText(t, { ...newDeck(), name: "Imported deck" });
            if (deckSize(r.deck) === 0 && !r.deck.leader) return r.note ?? "Nothing recognised";
            onEdit(r.deck);
            return null;
          }}
        />
      )}
      <div className="dl-body">
        <ArtDownload />
        {decks.length === 0 && <p className="hint">No decks yet.</p>}
        {decks.map((d) => {
          const leader = d.leader ? getCard(d.leader) : null;
          const problems = deckProblems(d);
          return (
            <div key={d.id} className="dl-row" onClick={() => onEdit(d)}>
              {leader ? <img src={cardImage(leader.id)} alt="" /> : <span className="card slot" />}
              <div>
                <b>{d.name}</b>
                <small>{leader?.name ?? "no leader"} · {deckSize(d)}/50{problems.length ? " · not legal yet" : ""}</small>
              </div>
              <button className="ghost small" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${d.name}?`)) onDelete(d); }}>Delete</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
