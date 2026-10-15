import { useEffect, useRef } from "react";
import type { ProjectedLogEntry } from "@tcg/op-engine";

export function Log({ logs, onClose }: { logs: ProjectedLogEntry[]; onClose: () => void }) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    body.current?.scrollTo(0, body.current.scrollHeight);
  }, [logs.length]);

  let turn = -1;
  return (
    <div className="log">
      <div className="log-head">
        <b>Log</b>
        <button className="ghost small" onClick={onClose} aria-label="hide log">✕</button>
      </div>
      <div className="log-body" ref={body}>
        {logs.map((l) => {
          const mark = l.turn !== turn;
          turn = l.turn;
          return (
            <div key={l.id} className={`log-line ${l.actor === "south" ? "me" : ""}`}>
              {mark && <span className="turn">turn {l.turn}</span>}
              {l.message}
            </div>
          );
        })}
      </div>
    </div>
  );
}
