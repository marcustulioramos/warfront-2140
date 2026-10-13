# Architecture

The server is authoritative. The simulation package owns rules and accepts commands plus an injected clock. The protocol package validates wire messages. The Babylon client renders server state. PostgreSQL is wired into the health check; durable match persistence is scheduled for the next milestone.

## Boundaries

- Simulation does not import browser, WebSocket or database code.
- Clients never calculate authoritative movement, combat or resources.
- Faction and map packages will supply data, not duplicated rule engines.
- A match host will own each active match exclusively.

## Planned persistence

Use versioned world snapshots, ordered accepted commands and durable game events. Recover by loading the latest valid snapshot and replaying subsequent durable input. Match time pauses during downtime. This is a design target; it is not implemented in Milestone 0.

## Database choice

Drizzle ORM is planned for typed PostgreSQL schema and versioned SQL migrations. No ORM tables are needed by the Milestone 0 health check.
