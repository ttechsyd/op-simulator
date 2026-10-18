import { useState } from "react";
import { claimUsername, signIn, signOut, type User } from "./auth";
import { configured } from "./firebase";

// the one line on the menu that says who you are, or offers to find out
export function Account({ user, badge, onFriends }: { user: User | null | undefined; badge: number; onFriends: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!configured || user === undefined) return null;
  if (!user)
    return (
      <div className="account">
        <button
          className="ghost"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            signIn()
              .catch((e: Error) => setError(e.message || "Sign-in failed"))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Signing in…" : "Sign in with Google"}
        </button>
        {error && <small className="bad">{error}</small>}
        <small className="hint">Needed for friends, chat and shared decks. Playing offline doesn't.</small>
      </div>
    );
  return (
    <div className="account">
      <button className="ghost" onClick={onFriends}>
        {user.photo && <img src={user.photo} alt="" />}
        {user.username ?? "…"}
        {badge > 0 && <span className="badge">{badge}</span>}
      </button>
      <button className="link" onClick={() => signOut()}>sign out</button>
    </div>
  );
}

// a signed-in player without a name can't be found or messaged, so this sits over the menu
export function UsernameSheet({ uid, onDone }: { uid: string; onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "taken" | "invalid">("idle");
  const claim = () => {
    setState("busy");
    claimUsername(uid, name).then((r) => {
      if (r === "ok") onDone(name.trim());
      else setState(r);
    });
  };
  return (
    <div className="scrim">
      <div className="sheet">
        <h3>Pick a username</h3>
        <p className="hint">3 to 16 letters, numbers or underscores. Friends find you by it.</p>
        <input
          value={name}
          maxLength={16}
          autoFocus
          placeholder="username"
          onChange={(e) => {
            setName(e.target.value);
            setState("idle");
          }}
          onKeyDown={(e) => e.key === "Enter" && claim()}
        />
        {state === "taken" && <p className="hint bad">That one's taken.</p>}
        {state === "invalid" && <p className="hint bad">Letters, numbers and underscores only, 3 to 16 of them.</p>}
        <div className="actions">
          <button className="ghost" onClick={() => signOut()}>Sign out</button>
          <button disabled={state === "busy" || name.trim().length < 3} onClick={claim}>
            {state === "busy" ? "Checking…" : "Claim"}
          </button>
        </div>
      </div>
    </div>
  );
}
