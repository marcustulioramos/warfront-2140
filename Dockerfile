FROM node:24-bookworm-slim AS base
RUN npm install -g pnpm@10.18.3
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/simulation/package.json packages/simulation/package.json
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
FROM base AS server
CMD ["node","apps/server/dist/index.js"]
FROM base AS client
CMD ["pnpm","--filter","@warfront/client","dev"]