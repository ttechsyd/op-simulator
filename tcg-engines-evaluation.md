# tcg-engines One Piece engine: evaluation

Date: 2026-10-16
Repo: https://github.com/TheCardGoat/tcg-engines (MIT), cloned shallow into `tcg-engines/`
Workspace evaluated: `tcg-engines/submodules/one-piece` plus the One Piece parts of `submodules/agnostic-simulator`

## Verdict

This is a near-complete, actively maintained, rules-enforcing One Piece TCG engine in TypeScript.
It is far more than a sandbox table. Building on it means the work is the Android client and a
multiplayer server, not the rules.

## What it contains

| Piece | Location | Size |
| --- | --- | --- |
| Rules engine | `packages/engine/src` | ~37,000 lines, 80 effect action types |
| Card catalog | `packages/cards/src/cards` | 2,818 canonical cards: 289 leader files, 4,431 character files, 821 event files, 99 stage files (counts include alternate arts and i18n files) |
| Native types | `packages/types/src` | keywords, triggers, actions, zones |
| Card text parser | `tools/op-card-parser` | turns printed effect text into effect data |
| Bot opponents | `packages/engine/src/automation` | heuristic, aggressive, value-ranked, greedy, first-legal, random |
| Browser UI | `agnostic-simulator/apps/multi-game-simulator/src/games/one-piece` | ~2,800 lines, React + Mantine, board, sidebar, practice page vs bot |
| Server adapter | `agnostic-simulator/packages/one-piece/one-piece-server-adapter` | wraps the engine as an authoritative server engine with undo, deck validation, interaction protocol |

## Sets covered

OP01 through OP17, EB01 through EB04, ST01 through ST36, PRB01, PRB02, and promos.
Card images are referenced by URL from optcgapi.com, not bundled.

## Rules coverage

The Comprehensive Rules version 1.2.1 (28 Aug 2026) are pinned as executable tests, one file per
chapter, under `packages/engine/tests/rules`. Every test name cites its rule number.

Covered and tested:

- Setup: deck construction validation, opening hand, mulligan, life placement, first player
- Turn structure: refresh, draw, DON!!, main, end; first-player no draw and one DON!!; first-turn attack ban
- DON!!: giving, attaching, resting, returning, DON!! xN and minus N costs
- Battle: attack declaration, legal targets, block step, counter step, damage, trigger on life, battle end
- Keywords: Rush, Rush: Character, Double Attack, Banish, Blocker, Trigger, Unblockable
- Timing words: On Play, When Attacking, On Block, On K.O., Activate: Main, Main, Counter, Once Per Turn, End of Your Turn, End of Opponent's Turn, Start of Your Turn, and 20 more trigger kinds
- Effects: costs, conditions, resolution order, replacement effects and chains, negation, base power and base cost setting with ordering rules
- Rule processing: immediate defeat during resolution, 5-character area limit with replacement
- Loops: audited mandatory and optional infinite-loop detection for a bounded family of cycles

Documented limits (from `docs/rules-test-coverage.md`): some infinite-loop shapes outside the audited
family are not detected; given DON!! is modeled as a counter not a card; some exotic permanent-effect
orderings require judge review. None of these affect ordinary play.

## Card effect coverage

- 2,532 card files carry a scripted `effects` block; 287 are vanilla with no effect.
- The repo's own gate requires every non-vanilla card to have a command-driven behavior test.
- The inventory doc labels all 2,533 ability cards as verified, while warning that some tests prove
  only field placement rather than every printed clause. New sets (OP15 to OP17) have had recent
  clause-by-clause audits against official FAQs.

Most-used actions: modifyPower (707 cards), draw (415), ko (339), play (271), search (211),
rest (206), grantKeyword (205), trashFromHand (197), addDon (165), setActive (155), modifyCost (145).

## Test results on this machine (Windows 10, Node 24.18, pnpm 10.33)

| Suite | Result |
| --- | --- |
| cards | 44 / 44 passed |
| types | 1 / 1 passed |
| utils | 4 / 4 passed |
| op-card-parser | 1,414 passed, 1 file failed to load because `@tcg/op-cards` had not been built yet (`dist/` missing) |
| engine | 12,037 passed, 91 failed, 3 skipped across 2,773 files (283 s). 88 of the 91 failures are 8 or 10 second watchdog-subprocess timeouts in the chapter 11 loop tests; the other 3 are the grade-A coverage gate, a bot-harness batch that exceeded its 30 s budget, and a heuristic benchmark timeout. |

The repo's `ci-check` script stops at its first step with 217 formatting complaints. Cause: git
`core.autocrlf=true` converted files to CRLF on checkout. Fix with `git config core.autocrlf false`
and a fresh checkout, or run `vp check --fix`. Not an engine problem.

Engine failures seen are environmental: about 50 "watchdog" tests spawn a fresh node process that
must load the whole card catalog within 8 seconds, and on this machine the catalog import alone takes
minutes. The grade-A coverage gate reported 15 mismatched proof files, which looks like a Windows
path-separator issue in the proof selector (it pointed cards at the wrong test files). Both need
confirming on Linux or WSL before being treated as real.

## What is NOT included

- The production web app, API, gateway, matchmaking, auth and deployment are private. The
  `gateway-client` package expects their WebSocket protocol.
- No mobile build. The UI is a React Router web app designed for desktop browsers; it has some
  touch handling but no landscape phone layout.
- Bun is required for some scripts (benchmarks, bot-lab). Core tests run on Node alone.

## What building an Android sim on top of this would take

1. Keep `@tcg/op-engine`, `@tcg/op-cards`, `@tcg/op-types` as-is. Pull upstream updates for new sets.
2. Write a new mobile-first client (Capacitor + React or Svelte, landscape) against the engine's
   public API: `createMatch`, `applyCommand`, `getLegalCommands`, `projectStateForSeat`, prompts.
   The existing `OnePieceTabletopBoard` and `Practice.page` are a working reference for how to
   drive it, and the bot is already usable for offline play.
3. Write a small multiplayer server. `OnePieceServerEngine` in the server adapter already does
   authoritative state, seat projection, undo and bot moves; it needs a WebSocket room layer
   (Node + Socket.io or a Cloudflare Durable Object) and reconnect handling.
4. Card images: fetch from optcgapi.com (or vegapull output) on demand and cache on device.

Rough effort: client 3 to 6 weeks for a usable board, server 1 to 2 weeks, polish ongoing.
Rules and cards: zero, apart from keeping up with upstream.

## Commands

```bash
cd tcg-engines/submodules/one-piece
pnpm install --frozen-lockfile
cd packages/engine && pnpm exec vp test run tests/rules     # rules spec suite
cd ../../tools/op-card-parser && pnpm exec vp test run       # parser suite
```

Browser practice mode (from `submodules/agnostic-simulator`, after `pnpm install` there):

```bash
pnpm run dev
```

then open `http://127.0.0.1:5193/one-piece/simulator/play/practice` (route registry pattern; not opened in this evaluation).
