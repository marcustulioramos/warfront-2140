# Warfront 2140 progress tracker

This checklist tracks the milestones in the [original project brief](../README.md#the-game-we-are-building). A checked box means the work is implemented and verified; an unchecked box is still to do. Update this file in the same pull request as the work it records.

**Current stage:** Milestone 0 foundation is running locally. The game is not yet a playable multiplayer match.

## Milestone 0 — architecture and scaffolding

- [x] Review the game brief and choose a server authoritative, modular architecture.
- [x] Create the TypeScript monorepo with client, server, shared, protocol and simulation packages.
- [x] Add an injectable simulation clock and a small server owned movement simulation with a unit test.
- [x] Add the Fastify server, WebSocket development endpoint and PostgreSQL health check.
- [x] Add a basic Babylon.js battlefield scene.
- [x] Add Docker Compose for the client, server and PostgreSQL; build and start all three locally.
- [x] Verify the client returns HTTP 200 and the server health endpoint reports a working database connection.
- [x] Add README, architecture, game design, contribution and security documentation.
- [x] Add a GitHub Actions workflow for format, lint, type checking, tests and builds.
- [x] Run local formatting, lint, type checking, tests and builds successfully.
- [ ] Confirm that the GitHub Actions workflow passes on the hosted repository.

## Milestone 1 — single-player simulation prototype

- [ ] Create a terrain and camera suitable for RTS controls.
- [ ] Select a unit and issue a move command from the browser.
- [ ] Broadcast authoritative movement updates so the client renders ongoing movement.
- [ ] Restore match state after browser refresh and server restart.
- [ ] Test command validation and movement end to end.

## Milestone 2 — multiplayer

- [ ] Add accounts, authentication, match creation and a lobby.
- [ ] Support two simultaneous players, including the same faction with different colours.
- [ ] Validate unit ownership on every command and filter state per player.
- [ ] Test shared state, disconnect and reconnect in two browser sessions.

## Milestone 3 — combat

- [ ] Add scout, medium assault and artillery roles with health, weapons and damage.
- [ ] Resolve combat on the server and render the results in the client.
- [ ] Persist destroyed units and test combat recovery after restart.

## Milestone 4 — economy

- [ ] Add a resource node, resource facility and factory.
- [ ] Implement building construction and unit production with scheduled completion.
- [ ] Keep production progressing while a player is disconnected.

## Milestone 5 — persistence

- [ ] Add durable commands, versioned world snapshots and scheduled events.
- [ ] Restore movement, construction and other pending work after a server restart.
- [ ] Test crash recovery and prevent duplicate grants or event effects.

## Milestone 6 — offline armies

- [ ] Add named armies and strategic travel orders.
- [ ] Add attack, defend, retreat threshold and post-battle standing orders.
- [ ] Generate battle reports and a reconnect summary for offline events.
- [ ] Test an attack that continues and resolves while both players are offline.

## Milestone 7 — destruction and respawn

- [ ] Detect when a player has no viable military or economic presence.
- [ ] Schedule a server chosen, safe recovery location and limited recovery base.
- [ ] Preserve faction, colour and completed research without restoring lost territory.
- [ ] Add temporary protection with clear expiry and cancellation rules.
- [ ] Test respawn and protection across a server restart.

## Milestone 8 — large map architecture

- [ ] Add sectors, territory ownership and strategic objectives.
- [ ] Add sector level routes, local movement and basic pathfinding benchmarks.
- [ ] Add server controlled fog of war and network interest management.

## Milestone 9 — faction system

- [ ] Add data driven faction definitions for Imperial Vanguard and Iron Battalion.
- [ ] Keep combat rules shared while giving each faction original visuals.
- [ ] Verify identical faction choices remain distinguishable through colour and symbols.

## Milestone 10 — victory

- [ ] Add domination or central objective victory rules.
- [ ] Start and cancel a victory pending timer as control changes.
- [ ] Finish and archive a match only when its configured condition is met.

## Milestone 11 — ten-player testing

- [ ] Test ten connected players, hundreds of units, offline armies and respawns.
- [ ] Measure tick time, CPU, memory, pathfinding, snapshots and network traffic.
- [ ] Optimize measured bottlenecks before raising unit limits.

## Cross-cutting work

- [ ] Choose and add an open source licence.
- [ ] Add schema migrations and durable match data in PostgreSQL.
- [ ] Harden authentication, rate limiting and visibility before public game hosting.
- [ ] Add deployment guidance for an Ubuntu host with HTTPS and backups.
