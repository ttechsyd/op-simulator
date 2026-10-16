# built from the repo root so the engine submodule is in the context:
#   fly deploy --config server/fly.toml --dockerfile server/Dockerfile .
FROM node:22-bookworm-slim AS build
RUN npm install -g corepack@latest && corepack enable
WORKDIR /src
COPY . .
RUN cd tcg-engines/submodules/agnostic-simulator \
 && CI=true pnpm install --frozen-lockfile --filter @tcg/bot-core --filter @tcg/engine-core --filter @tcg/protocol
RUN cd tcg-engines/submodules/one-piece && CI=true pnpm install --frozen-lockfile && pnpm exec turbo run build
RUN cd server && pnpm install --frozen-lockfile && pnpm build

# the bundle carries the engine, the cards and ws, so nothing else is needed at runtime
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /src/server/dist/server.mjs .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
