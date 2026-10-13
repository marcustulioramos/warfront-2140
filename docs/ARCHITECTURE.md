# Architecture

The server is authoritative. The simulation package owns rules and accepts commands plus an injected clock. The protocol package validates wire messages. The Babylon client renders server state. A single match host currently owns the development match.

## Boundaries

- Simulation does not import browser, WebSocket or database code.
- Clients submit a destination; the server validates ownership and bounds, advances movement at five ticks per second, and broadcasts state.
- Rendering interpolates toward received positions but does not decide authoritative positions.
- Faction and map packages will supply data without duplicating rule engines.

## Milestone 1 persistence

A versioned PostgreSQL world snapshot stores the development match. The server applies the SQL migration in `infrastructure/sql/0001_world_snapshots.sql` on startup and validates loaded snapshots through the protocol schema. An accepted move is saved before its acknowledgement is sent. Movement snapshots are saved every ten ticks and on graceful shutdown. Restoring a snapshot resets the simulation's time baseline, so movement does not jump forward during server downtime.

A sudden crash may lose up to about two seconds of movement since the last periodic snapshot. Milestone 5 will add durable accepted commands, event replay and stronger crash recovery. The single snapshot row is a Milestone 1 step toward that design, not the final persistence system.

## Database access

The current snapshot store uses `pg` and a checked-in SQL migration. Drizzle remains the planned choice when relational match data and the full migration workflow are introduced. The simulation package does not depend on either database tool.

## Security boundary

The current development WebSocket uses one hardcoded player identity and the `/state` endpoint exposes the development match. Keep this build on a trusted local network. Authentication and per-player visibility are required before public hosting.
