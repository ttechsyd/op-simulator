#!/usr/bin/env bash
# Fresh clone to working app in one go. Also what the cloud environment runs on start.
set -euo pipefail
cd "$(dirname "$0")/.."

git submodule update --init
# the app pins pnpm 12, which the corepack bundled with node 22 can't run
npm install -g corepack@latest >/dev/null 2>&1 || true
corepack enable

(cd tcg-engines/submodules/agnostic-simulator && CI=true pnpm install --frozen-lockfile --filter @tcg/bot-core --filter @tcg/engine-core --filter @tcg/protocol)
(cd tcg-engines/submodules/one-piece && CI=true pnpm install --frozen-lockfile && pnpm exec turbo run build)
(cd app && pnpm install --frozen-lockfile && pnpm build)
(cd server && pnpm install --frozen-lockfile && pnpm build)

echo "ready: $(cd app && node --input-type=module -e "import { allCards } from '@tcg/op-cards'; console.log(allCards.length)") cards"
