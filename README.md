# Warfront 2140

Warfront 2140 is an open source, browser based persistent RTS in early development. This repository currently contains the Milestone 0 foundation and a development battlefield. It is **not yet a playable multiplayer match**.

## Local start

1. Install Docker Desktop with Compose.
2. Copy `.env.example` to `.env`.
3. Run `docker compose up --build`.
4. Open http://localhost:5173. The server health endpoint is http://localhost:3000/health.

The health endpoint returns 503 if PostgreSQL is unavailable. The first scene displays a server owned development unit. Accounts, durable match recovery, combat and matchmaking are later milestones.

## Development checks

With Node.js 24 and pnpm 10: `pnpm install`, then `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

See [architecture](docs/ARCHITECTURE.md), [game design](docs/GAME_DESIGN.md), [contributing](CONTRIBUTING.md), and [security](SECURITY.md).
