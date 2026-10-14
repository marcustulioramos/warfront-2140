# Architecture

The server is authoritative. The simulation package owns rules and accepts commands plus an injected clock. The protocol package validates wire messages. The Babylon client renders server state. A match host is created for each active match and keeps its own simulation, WebSocket group and PostgreSQL snapshot.

## Boundaries

- Simulation does not import browser, WebSocket or database code.
- Clients submit movement or attack orders; the server validates ownership and targets, advances movement and combat at five ticks per second, and broadcasts state.
- Rendering interpolates toward received positions but does not decide authoritative positions.
- Faction and map packages will supply data without duplicating rule engines.

## Milestone 1 persistence

A versioned PostgreSQL world snapshot stores the development match. The server applies the SQL migration in `infrastructure/sql/0001_world_snapshots.sql` on startup and validates loaded snapshots through the protocol schema. An accepted move is saved before its acknowledgement is sent. Movement snapshots are saved every ten ticks and on graceful shutdown. Restoring a snapshot resets the simulation's time baseline, so movement does not jump forward during server downtime.

A sudden crash may lose up to about two seconds of movement since the last periodic snapshot. Milestone 5 will add durable accepted commands, event replay and stronger crash recovery. The single snapshot row is a Milestone 1 step toward that design, not the final persistence system.

## Milestone 2 multiplayer

The second SQL migration adds players, hashed passwords, sessions, matches and match membership. Accounts use salted scrypt password hashes. The browser receives an HttpOnly SameSite session cookie. Match creation and joining require that cookie; a row lock limits a match to two players even when joins race. A WebSocket must authenticate as a match member before receiving a snapshot. Every command uses the authenticated player ID, so a player cannot control the other army. Broadcasts are scoped by match ID. All units are visible to both participants because fog of war is a later milestone.

The lobby is intentionally small: matches are listed by name and player count, players can create, join and reconnect, and two players may pick the same faction. Distinct blue and orange colours are assigned by join order. Faction gameplay differences are planned for Milestone 9. The current match hosts are loaded on demand and pause movement during server downtime.

## Milestone 3 combat

Each player has a scout, medium assault unit and artillery. Role statistics define movement speed, health, damage, range and reload time. An attack order names an enemy unit; the server moves the attacker into range and resolves shots with a clock-driven reload timer. Damage on each tick is accumulated before it is applied, so opposing units can destroy each other on the same tick. No client-provided damage or hit result is trusted, and combat uses no uncontrolled randomness.

Snapshot version 2 stores each unit's health, role, target and remaining reload time. It also stores the player roster independently of living units, so reconnecting cannot recreate a destroyed army. Snapshot version 1 is upgraded on load, preserving existing matches and adding the two new roles. Clients render health bars, shot lines and a short destruction flash from server combat events. Offline army behavior remains Milestone 6 work.

## Milestone 4 economy

The simulation owns ore balances, resource nodes, buildings and factory jobs. Client commands specify a building type or production role; the server checks membership, ownership, available ore, construction state and factory capacity. A completed extractor earns ore from server timestamps. Construction and production jobs store absolute completion times in snapshot version 3. On restart, the host settles elapsed economy time and saves the result before sending it to clients. Movement and combat remain paused during server downtime. Version 2 combat snapshots are upgraded on load with starting ore and nodes; version 1 is upgraded through the same economy initialization.

## Milestone 5 persistence

The third SQL migration adds a match command journal keyed by match and command ID, plus scheduled-event rows for building and unit completion. An accepted command and its resulting versioned snapshot commit in one PostgreSQL transaction. Repeating the exact command ID returns the existing state; using that ID for a different order is rejected. Snapshot writes also register pending events and mark due events applied in the same transaction. The simulation derives resource income and job completion from saved timestamps, so restarting it cannot grant the same unit twice.

Every simulation tick is saved before being broadcast. This removes the previous two-second recovery gap for movement and combat. On startup, pending economy work is settled and saved before the first client snapshot. Movement and combat pause while the server is stopped; construction, ore income and production catch up by elapsed server time. The current single-host development deployment is the write owner for a match. Multi-host coordination and throughput are later scaling work.

## Database access

The current snapshot and lobby stores use `pg` and checked-in SQL migrations. Drizzle remains a possible choice as the relational model grows. The simulation package does not depend on database code.

## Security boundary

The development server authenticates browser sessions and checks match membership, but is not hardened for public hosting. Add login rate limiting, HTTPS, production session controls and network protection before exposing it publicly. See [SECURITY.md](../SECURITY.md).
