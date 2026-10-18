import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { getCard } from "@tcg/op-cards";
import type { User } from "./auth";
import { ago } from "./social";
import { db } from "./firebase";
import { cardImage } from "../cards";

type Match = { id: string; them: string; myLeader: string; theirLeader: string; won: boolean | null; turns: number; at: number };

export function History({ user, onBack }: { user: User; onBack: () => void }) {
  const [record, setRecord] = useState<{ wins: number; losses: number } | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);

  useEffect(() => {
    getDoc(doc(db, "users", user.uid)).then((s) => setRecord({ wins: (s.data()?.wins as number) ?? 0, losses: (s.data()?.losses as number) ?? 0 }));
    getDocs(query(collection(db, "matches"), where("uids", "array-contains", user.uid), orderBy("finishedAt", "desc"), limit(20))).then((snap) =>
      setMatches(
        snap.docs.map((d) => {
          const x = d.data();
          const other = (x.uids as string[]).find((u) => u !== user.uid)!;
          return {
            id: d.id,
            them: (x.names as Record<string, string>)[other] ?? "?",
            myLeader: (x.leaders as Record<string, string>)[user.uid],
            theirLeader: (x.leaders as Record<string, string>)[other],
            won: x.winner ? x.winner === user.uid : null,
            turns: x.turns as number,
            at: x.finishedAt?.toMillis?.() ?? 0,
          };
        }),
      ),
    ).catch(() => setMatches([]));
  }, [user.uid]);

  return (
    <div className="menu library">
      <h1>History</h1>
      {record && (
        <p className="hint">
          {record.wins} won · {record.losses} lost
        </p>
      )}
      <div className="list">
        {matches === null ? (
          <p className="hint">Loading…</p>
        ) : matches.length === 0 ? (
          <p className="hint">No online games yet. Only games between two signed-in players are kept.</p>
        ) : (
          matches.map((m) => (
            <div className="friend" key={m.id}>
              <img src={cardImage(m.myLeader)} alt="" />
              <span>
                <b>
                  {m.won === null ? "Draw" : m.won ? "Won" : "Lost"} vs {m.them}
                </b>
                <small>
                  {getCard(m.myLeader).name} vs {getCard(m.theirLeader).name} · {m.turns} turns · {ago(m.at)}
                </small>
              </span>
              <img src={cardImage(m.theirLeader)} alt="" />
            </div>
          ))
        )}
      </div>
      <button className="ghost" onClick={onBack}>Back</button>
    </div>
  );
}
