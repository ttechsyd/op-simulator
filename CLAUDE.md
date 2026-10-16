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
- Git has `core.longpaths` on for this clone; leave it.

## Multiplayer is coming

The bot is a stand-in for a real opponent. Keep the client seat-blind: draw the table from
`projectStateForSeat(state, ME)` and send `EngineCommand`s through one `send`; nothing in the
UI may peek at the opponent's hidden cards or drive their prompts. Anything that only works
because both seats live in the same process (undo snapshots, bot timers) stays inside
`match.ts` so a network transport can replace it.

## Working from a fresh clone (cloud sessions too)

`scripts/setup.sh` does everything: submodule, engine deps and build, app deps and build.
Type-check with `npx tsc --noEmit -p app`. Pushes to `main` that touch `app/` make
`.github/workflows/bundle.yml` publish a release the phone installs from its menu; native
changes (plugins, manifest, gradle) ship as `opsim.apk` on the same release. The signing key
lives in the repo secrets and in `app/android/keystore.properties` locally, never in git.
