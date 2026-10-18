# built from the repo root so the engine submodule is in the context:
#   fly deploy --config server/fly.toml --dockerfile server/Dockerfile .
# run scripts/patch-engine.sh first; the image has no git, so the context must already
# carry our engine patches.
FROM node:22-bookworm-slim AS build
RUN npm install -g corepack@latest && corepack enable
WORKDIR /src
COPY . .
RUN cd tcg-engines/submodules/agnostic-simulator \
 && CI=true pnpm install --frozen-lockfile --filter @tcg/bot-core --filter @tcg/engine-core --filter @tcg/protocol
RUN cd tcg-engines/submodules/one-piece && CI=true pnpm install --frozen-lockfile && pnpm exec turbo run build
RUN cd server && pnpm install --frozen-lockfile && pnpm build

# the bundle carries the engine, the cards and ws; firebase-admin is the one module it
# loads from disk, so it is installed on its own here
FROM node:22-bookworm-slim
WORKDIR /app
RUN npm init -y >/dev/null && npm install --omit=dev firebase-admin@13 >/dev/null
COPY --from=build /src/server/dist/server.mjs .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
