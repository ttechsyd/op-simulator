# OP Simulator

One Piece TCG simulator for Android. Rules engine comes from `tcg-engines/submodules/one-piece`
(MIT, upstream: TheCardGoat/tcg-engines). Our own code lives in `app/`.

## Code style: write it like a person wrote it

The code in this repo must not read as AI-generated. Concretely:

- No narrating comments. Don't explain what a line does when the line already says it.
  Comment only when the *why* is not obvious (a rules quirk, a workaround, a trade-off).
- No doc-comment on every function. Most functions get none. A short one is fine on a
  public entry point or something with a non-obvious contract.
- No section banners (`// ===== Helpers =====`), no emoji, no "Note:" / "Important:" prefixes.
- Names should sound like a dev who knows the game chose them: `restedDon`, `blockerPrompt`,
  `attackStep`, not `handleDataProcessing` or `utilityHelperFunction`.
- Don't over-abstract. Three similar lines beat a premature helper. No `utils.ts` dumping ground.
- Don't add defensive checks for things that cannot happen. Trust the engine's types.
- No boilerplate README prose, no "This project aims to…" intros, no feature bullet walls.
- Imperfect is fine. Leave a `TODO` where something is half-done instead of writing a
  polished stub. Inconsistent-but-reasonable formatting across files is normal.
- Commit messages: short, lowercase, present tense, like `fix counter step on blocked attack`.
- Keep files focused and modest in size. Don't generate ten files when two will do.

## Engine facts

- Public API: `createMatch`, `applyCommand`, `getLegalCommands`, `getPotentialCardCommands`,
  `projectStateForSeat`, `commandFromDescriptor`, `heuristicAgent`, `resolveBotPromptCommand`.
- Seats are `south` (us) and `north` (bot). Prompts live in `state.promptQueue`.
- Cards register themselves when `@tcg/op-cards` is imported. Images come from each
  printing's `imageUrl`, never bundled.
- Build the engine before the app: `pnpm exec turbo run build` in the one-piece workspace.
- Engine fixes upstream won't take live as diffs in `patches/`, applied onto the submodule's
  working tree by `scripts/patch-engine.sh` before every engine build (setup.sh, both
  workflows). The submodule itself keeps pointing at upstream.
- Git has `core.longpaths` on for this clone; leave it.

## Two kinds of table

The client talks to a `Table` (match.ts): `localTable` runs the engine in-process with the bot
or with both seats on one phone, `openRoom` (net.ts) talks to `server/`, a small Node
WebSocket service that owns the real state and sends it whole once, then as immer patches.
Keep the client seat-blind: draw the table from `projectStateForSeat(state, ME)` and send
`EngineCommand`s through one `send`; nothing in the UI may peek at the opponent's hidden
cards or drive their prompts. Anything that only works because both seats live in the same
process (undo snapshots, bot timers) stays inside `match.ts`.

The server is bundled with esbuild (`cd server && pnpm build`) because the engine's build
still imports a sibling package as TypeScript. `.github/workflows/server.yml` deploys it to
Fly as `op-simulator` on pushes to `server/`; it needs the `FLY_API_TOKEN` secret. Run it
locally with `pnpm --dir server dev` and open the app with `?server=ws://localhost:8787`.

## Online accounts

Sign-in, friends, chat, presence and push live in Firebase (free Spark plan); the code is in
`app/src/online/`. The web config goes in `app/src/online/firebase.ts`; until it is filled in
the whole online side stays hidden and the app is offline-only. Rules and indexes are in
`firebase/` (`npx firebase-tools deploy --only firestore,database`). The room server is the only
thing with admin credentials: run it with `FIREBASE_SERVICE_ACCOUNT=.secrets/service-account.json`
and `FIREBASE_DATABASE_URL=...` set, or without them for guest-only rooms. To test from a phone
without Fly, `cloudflared tunnel --url http://localhost:8787` and paste the `wss://` address into
the lobby's server field. `google-services.json` and `server/.secrets/` never go in git; CI gets the
former from the `GOOGLE_SERVICES_JSON_B64` secret.

## Working from a fresh clone (cloud sessions too)

`scripts/setup.sh` does everything: submodule, engine deps and build, app deps and build.
Type-check with `app/node_modules/.bin/tsc --noEmit -p app` (npx may pick a newer typescript).
`node scripts/fuzz.mjs [--rounds 6] [--seed 1] [deck.json ...]` plays every precon and test deck against each other
with bots and writes anything the engine got wrong to `scripts/fuzz-report.json`; `--pair A,B --seed N --log` replays one game.
A deck file can hold a list of decks; `--only scripts/decks/meta-2026-10.json` plays just the 15 tournament decks kept there.
Pushes to `main` that touch `app/` make
`.github/workflows/bundle.yml` publish a release the phone installs from its menu; native
changes (plugins, manifest, gradle) ship as `opsim.apk` on the same release. The signing key
lives in the repo secrets and in `app/android/keystore.properties` locally, never in git.
