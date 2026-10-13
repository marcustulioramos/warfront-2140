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

See the [progress tracker](docs/PROGRESS.md), [architecture](docs/ARCHITECTURE.md), [game design](docs/GAME_DESIGN.md), [contributing](CONTRIBUTING.md), and [security](SECURITY.md).

## The game we are building

Warfront 2140 is a browser based, server authoritative 3D strategy game for up to ten friends. Matches can last days or weeks. Armies keep travelling, fighting and following standing orders while their owners are offline; returning players receive reports of what happened. Players build bases, gather resources, research technology and fight for territory across a large sector based map. A destroyed player suffers a major setback but can respawn in a safe area and rebuild. The first goal is a reliable two player vertical slice, followed by measured expansion toward ten players.

The complete original project brief below is the long term vision and implementation roadmap. Its later milestones describe **planned work**, not features already available in this repository. The current status and running instructions are above.

<details>
<summary>Read the complete original project brief</summary>

```text
PROJECT: WARFRONT 2140

ROLE

You are the lead game architect, senior multiplayer engineer and technical lead for Warfront 2140.

Your job is to design and implement a serious open source multiplayer real time strategy game.

Warfront 2140 is inspired by classic RTS games, particularly Warzone 2100, large scale persistent strategy games, science fiction warfare, territorial strategy and long running multiplayer games.

Do not build a toy demo.

Do not create a simple arena where a handful of tanks shoot each other and consider the project complete.

Build the game incrementally with production quality architecture, automated tests, documentation, Docker based local hosting, persistent multiplayer matches and a clear path towards production hosting.

The long term goal is a game that approximately 10 friends can play together over several days or weeks.

==================================================
1. CORE GAME CONCEPT
==================================================

Warfront 2140 is a browser based 3D multiplayer real time strategy game.

The game takes place on a very large continuous battlefield.

Up to 10 players participate in a free for all war.

Players:

build bases
gather resources
research technology
manufacture units
organise armies
capture territory
launch attacks
defend territory
destroy enemy bases
control strategic objectives

A match does not finish in one session.

A match may last:

several days
one week
two weeks
or potentially longer

Players do NOT need to remain online.

The server continues the war while players are offline.

Example:

Player A logs in at 22:00.

Player A orders Army Alpha to cross the map and attack Player B.

The journey takes approximately three real world hours.

Player A closes the browser and goes to sleep.

The authoritative server continues processing the army's movement.

At approximately 01:00 the army arrives.

If Player B has defences, armies or standing orders, the battle takes place automatically.

Neither player needs to be online.

At 08:00 Player A reconnects.

The game reports:

Army Alpha reached the objective.

Battle occurred at 01:07.

32 enemy units destroyed.

11 friendly units lost.

Enemy resource facility destroyed.

Sector captured.

Army Alpha is currently holding the sector.

The battlefield must evolve continuously even when no human player is connected.

The match eventually ends when one player achieves the configured victory conditions.

The finished world is archived.

Players can then start another match.

Player accounts, statistics, historical match data and achievements remain.

Combat progression, territory and research normally reset between matches.

==================================================
2. CORE DESIGN IDENTITY
==================================================

The defining experience should be:

I open Warfront 2140.

The war has continued while I was away.

I receive a summary.

For example:

3 battles occurred.

2 territories captured.

17 units lost.

42 enemy units destroyed.

Heavy armour research completed.

A factory finished construction.

Army Omega reached its objective.

An enemy army has entered one of my sectors.

I inspect the battlefield.

I issue new orders.

I build units.

I organise armies.

I launch attacks.

I set standing orders.

I close the browser.

The war continues.

This persistent offline capable warfare is the core identity of Warfront 2140.

==================================================
3. TECHNOLOGY STACK
==================================================

Use this technology stack unless architectural investigation reveals a strong technical reason to change something.

PRIMARY LANGUAGE

TypeScript

CLIENT

TypeScript

Babylon.js

Vite

WebGL

WebGPU where available

SERVER

Node.js

TypeScript

Fastify for HTTP APIs

WebSockets for real time communication

The simulation engine must NOT depend directly on WebSockets.

Networking should be implemented through adapters around the core simulation.

DATABASE

PostgreSQL

DATABASE ACCESS

Choose between:

Drizzle ORM

or

Prisma

Choose whichever best suits the project and briefly document the decision.

TESTING

Vitest

Integration tests

Playwright for important browser flows where appropriate

INFRASTRUCTURE

Docker

Docker Compose

LOCAL DEVELOPMENT

The complete project must be runnable locally.

PRODUCTION TARGET

Ubuntu Linux

DigitalOcean Droplet initially

Do NOT require Kubernetes.

Do NOT begin with unnecessary microservices.

Keep the architecture modular while keeping deployment straightforward.

==================================================
4. MONOREPO STRUCTURE
==================================================

Use a monorepo.

Suggested structure:

/apps
    /client
    /server

/packages
    /simulation
    /shared
    /protocol
    /factions
    /maps

/infrastructure

/docs

Responsibilities:

apps/client

Babylon.js rendering

UI

camera

input

unit selection

animations

effects

audio

network client

game HUD

minimap

battle reports

apps/server

authentication

lobbies

match lifecycle

database access

WebSocket management

simulation hosting

persistence

reconnection

battle reports

administration

packages/simulation

Authoritative game simulation.

Must not depend on:

Babylon.js

DOM APIs

browser APIs

rendering code

The simulation should be runnable independently in tests.

packages/shared

Shared types and utilities.

packages/protocol

Client and server network message definitions.

packages/factions

Faction definitions.

Unit templates.

Building templates.

Visual configuration.

packages/maps

Map definitions.

Sector definitions.

Procedural generation systems where appropriate.

==================================================
5. SERVER AUTHORITATIVE ARCHITECTURE
==================================================

The server is authoritative.

Clients NEVER determine:

damage

health

resources

production completion

research completion

unit ownership

unit positions

army positions

building completion

territory ownership

combat results

respawn positions

player protection

victory conditions

Clients submit commands.

Examples:

MOVE_UNITS

MOVE_ARMY

ATTACK_TARGET

ATTACK_SECTOR

DEFEND_SECTOR

CAPTURE_SECTOR

BUILD_STRUCTURE

QUEUE_UNIT

START_RESEARCH

CREATE_ARMY

ASSIGN_UNIT_TO_ARMY

SET_STANDING_ORDERS

SET_RETREAT_THRESHOLD

PATROL

ESCORT

RETREAT

The server validates every command.

The server executes valid commands.

The server rejects invalid commands.

The client renders the resulting authoritative state.

Never trust client supplied game state.

==================================================
6. SIMULATION FREQUENCY
==================================================

Do not simulate everything at 60 updates per second.

Rendering and simulation are separate.

The client may render at:

60 FPS

120 FPS

or another suitable rate.

The authoritative simulation should initially target approximately:

5 to 10 simulation ticks per second

for active movement and combat.

Long duration activities should use scheduled events and timestamps.

Examples:

construction

research

manufacturing

resource production

long distance travel

respawn timers

protection timers

If building a tank takes 30 minutes, do not update its construction progress 10 times every second.

Store:

startedAt

completionAt

When completionAt is reached, process the completion.

Design inactive regions so they are cheap to maintain.

==================================================
7. GAME CLOCK
==================================================

Create a simulation clock abstraction.

Do NOT tightly couple game logic to Date.now().

Production may use real time.

Tests must be able to manipulate time.

For example:

clock.advanceBy(hours(3))

This is critical for testing:

offline attacks

construction

research

respawning

protection periods

long distance travel

match victory timers

Tests must never need to literally wait several hours.

==================================================
8. PERSISTENCE
==================================================

A server restart must not destroy a running match.

Implement:

periodic world snapshots

important game event persistence

validated player command persistence where appropriate

scheduled event persistence

On startup:

load latest world snapshot

restore persistent entities

restore pending events

restore travel orders

restore construction

restore research

restore respawn timers

restore protection timers

restore standing army orders

resume the match

The architecture should tolerate crashes.

During the first version:

unexpected server downtime pauses game time.

Do NOT silently resolve hours of combat while the server itself was unavailable.

This policy can become configurable later.

==================================================
9. MATCH LIFECYCLE
==================================================

A match has these states:

LOBBY

Players join.

Host configures settings.

Players select factions.

Players receive or select available colours.

Players ready themselves.

PREPARATION

Starting positions are assigned.

Bases spawn.

Starting protection begins.

Players begin construction and exploration.

WAR

Normal gameplay.

RESPAWNING

Individual players may independently enter a destroyed and respawning state while the overall match continues.

VICTORY_PENDING

A player has triggered a victory condition requiring a timer.

Example:

holding 70 percent of strategic territory continuously.

FINISHED

Winner declared.

World becomes read only.

Statistics generated.

ARCHIVED

Historical match remains accessible.

==================================================
10. PLAYER COUNT
==================================================

Support up to:

10 players

in one match.

Initial development may use fewer players.

The architecture must never assume exactly two players.

Initial primary game mode:

FREE FOR ALL

Every player is an independent competitor.

Future modes may support teams and alliances.

==================================================
11. MAP DESIGN
==================================================

The map should feel enormous.

Do not make a giant empty flat plane.

The map should contain:

mountains

valleys

forests

open plains

deserts where appropriate

ruined cities

roads

rivers

bridges

industrial areas

abandoned military facilities

resource fields

strategic chokepoints

high ground

central objectives

hidden routes

defensible regions

Create one continuous visual battlefield.

Under the visual world, divide the map into logical sectors.

Early versions may use approximately:

50 to 100 sectors.

Each sector should support:

id

terrain type

owner

contested state

resource nodes

buildability

structures

units

visibility

strategic importance

adjacency

possible respawn suitability

The sector system supports:

territory ownership

resource management

strategic navigation

fog of war

AI and standing orders

network interest management

respawning

victory conditions

==================================================
12. CAMERA
==================================================

Use familiar RTS camera controls.

Support:

pan

zoom

rotate

keyboard movement

mouse movement

optional edge scrolling

Camera should work well on large maps.

The player must be able to quickly move between:

headquarters

armies

alerts

battle locations

strategic objectives

==================================================
13. UNIT SELECTION
==================================================

Support:

left click single selection

drag selection rectangle

Shift to add units

Shift to remove units

double click unit type selection where appropriate

army selection

Control groups should eventually support:

Ctrl + 1

Ctrl + 2

etc.

==================================================
14. COMMANDS
==================================================

Basic controls:

right click terrain to move

right click enemy to attack

right click friendly structure where appropriate

right click objective to interact or capture

Commands must feel like a traditional RTS when the player is online.

The same armies must also continue following valid standing orders after the player disconnects.

==================================================
15. UNIT ROLES
==================================================

Do not create entirely separate simulation code for every faction.

Use common military roles.

Possible roles:

SCOUT

LIGHT_ASSAULT

MEDIUM_ASSAULT

HEAVY_ASSAULT

ARTILLERY

ANTI_AIR

AIR_SUPERIORITY

BOMBER

TRANSPORT

ENGINEER

SUPPORT

RECON

Each faction visually interprets those roles differently.

==================================================
16. FACTION CONCEPT
==================================================

One of Warfront 2140's major features is that players may command radically different looking armies.

The factions can be inspired by broad genres.

They must remain original.

Do NOT directly copy:

Star Wars

Star Trek

Avatar

Ghostbusters

Mario Kart

Halo

Warhammer

Terminator

or another copyrighted franchise.

Do not reproduce:

protected character designs

specific vehicle designs

logos

symbols

names

recognisable silhouettes

sounds

music

textures

models

Factions should instead interpret broad ideas.

==================================================
17. INITIAL FACTIONS
==================================================

FACTION 1

IMPERIAL VANGUARD

Theme:

Futuristic authoritarian galactic military.

Broad inspiration:

classic space opera

giant mechanical armies

advanced militarised civilisations

Visual direction:

massive walkers

hovering armour

energy artillery

advanced aircraft

dark metallic materials

angular structures

large command facilities

Do not reproduce recognisable Star Wars vehicles.

FACTION 2

IRON BATTALION

Theme:

WWII and dieselpunk inspired military.

Visual direction:

tracked tanks

artillery

armoured vehicles

propeller aircraft

bunkers

radar stations

heavy factories

industrial construction

Historical inspiration is acceptable.

Do not copy copyrighted game assets.

FACTION 3

WILDBORN CLANS

Theme:

Biological alien civilisation.

Visual direction:

giant creatures

armoured animals

living artillery

flying biological units

organic buildings

bioluminescent materials

grown structures rather than constructed structures

FACTION 4

NEXUS COLLECTIVE

Theme:

Machine intelligence.

Visual direction:

autonomous robots

tracked robotic armour

spider machines

hover drones

automated factories

machine fortresses

dark futuristic materials

sensor arrays

==================================================
18. DATA DRIVEN FACTION SYSTEM
==================================================

Faction functionality should be data driven.

Do not duplicate game logic for factions.

Conceptual data structure:

Faction

id
name
description
theme
units
buildings
effects
audioProfile
visualProfile

UnitDefinition

role
displayName
model
movementProfile
weaponProfile
armourProfile
effectsProfile
soundProfile
scale
playerColourMask

Combat statistics should use reusable profiles.

Example:

heavy_assault_tier_1

An Iron Battalion heavy assault unit may be a tank.

An Imperial Vanguard version may be a walker.

A Wildborn version may be a giant armoured creature.

A Nexus Collective version may be a robotic crawler.

They should initially be approximately equal in battlefield strength.

Later factions may have strengths and weaknesses, but competitive balance should remain central.

==================================================
19. PLAYER COLOURS
==================================================

Multiple players may choose the same faction.

Faction choice must NOT determine player colour.

Example:

Player 1

Faction:
Imperial Vanguard

Colour:
Blue

Player 2

Faction:
Imperial Vanguard

Colour:
Red

Player 3

Faction:
Iron Battalion

Colour:
Yellow

Even when using identical factions, players must be visually distinguishable.

Player colour should affect suitable parts of:

armour panels

vehicle markings

flags

lights

building highlights

UI

health indicators

territory outlines

minimap symbols

army icons

Do NOT simply recolour the entire model.

Faction identity must remain recognisable.

For example:

Imperial Vanguard units may retain dark metallic armour while specific armour panels, lights and insignia use the player's assigned colour.

Each match player should have:

playerId

factionId

playerColour

playerSymbol

The server determines colour assignments.

The client renders those assignments.

==================================================
20. COLOUR ACCESSIBILITY
==================================================

Support a predefined palette of approximately 10 highly distinguishable player colours.

Avoid assigning colours that are extremely similar.

Colour alone must not be the only identifier.

Also use:

player names

symbols

icons

unit markers

territory patterns where appropriate

Consider colour blindness.

The architecture should later allow accessibility settings such as:

alternative colour palettes

high contrast faction markers

colour blind presets

==================================================
21. COMMUNITY FACTIONS
==================================================

The architecture should eventually allow community created factions.

Do NOT implement a public workshop initially.

However, adding a new faction should not require modifying core simulation systems.

A faction should primarily provide:

models

animations

effects

sounds

unit definitions

building definitions

visual configuration

Only assets needed for factions participating in the current match should need to be downloaded.

==================================================
22. BASE BUILDING
==================================================

Players start with a headquarters and basic construction capability.

Possible structures:

Headquarters

Power Generator

Resource Processor

Factory

Heavy Factory

Aircraft Factory

Research Centre

Radar

Repair Facility

Defensive Turret

Anti Air Defence

Artillery Defence

Storage

Command Centre

Buildings should have configurable:

construction time

health

armour

cost

energy requirement

production capability

weapon capability

sensor capability

==================================================
23. ECONOMY
==================================================

Start with a relatively simple economy.

Primary resources:

Materials

Energy

Materials support:

building construction

vehicle production

repairs

Energy supports:

advanced facilities

research

advanced weapons

special systems

Resource nodes exist around the map.

Territorial expansion should create economic advantages.

Avoid overly complicated economics initially.

==================================================
24. RESEARCH
==================================================

Research provides progression during the match.

Possible categories:

Weapons

Armour

Engines

Energy

Sensors

Aircraft

Automation

Defence

Research resets for a new match.

Permanent player progression must not provide permanent combat advantages.

Permanent progression may eventually include:

cosmetics

statistics

achievements

titles

profile rewards

Avoid pay to win architecture.

==================================================
25. ARMIES
==================================================

Players can group units into named armies.

Example:

Army Omega

27 heavy assault units

12 anti air units

8 artillery units

4 scouts

An army is a logical collection of units.

Possible army missions:

MOVE

ATTACK

DEFEND

PATROL

CAPTURE

ESCORT

RETREAT

HOLD_POSITION

RETURN_TO_BASE

==================================================
26. OFFLINE AUTONOMY
==================================================

Offline autonomous operation is one of the defining mechanics.

Players must not need to remain connected.

Armies can have standing orders.

ENGAGEMENT MODE

AGGRESSIVE

BALANCED

DEFENSIVE

AVOID_COMBAT

RETREAT THRESHOLD

Example:

Retreat if army combat strength drops below 30 percent.

TARGET PRIORITIES

closest enemy

artillery

air units

heavy units

defences

resource infrastructure

production structures

headquarters

highest threat

POST BATTLE ORDERS

continue mission

hold captured territory

return to base

retreat to friendly territory

request reinforcement

The first implementation can support:

attack objective

defend objective

retreat threshold

continue mission after combat

==================================================
27. COMBAT
==================================================

Combat runs on the authoritative server.

Units may have:

health

armour

movement speed

weapon range

weapon damage

reload time

accuracy

target priority

movement class

sensor range

Possible damage classes:

KINETIC

EXPLOSIVE

ENERGY

BIOLOGICAL

Start with a small number of damage systems.

Do not overcomplicate combat initially.

Projectiles and visual effects are client side representations of server approved combat events.

==================================================
28. DETERMINISM
==================================================

Combat should be reproducible enough for:

testing

debugging

battle reports

future replay

Use seeded random number generation where practical.

Store relevant random seeds.

Avoid uncontrolled Math.random() calls throughout simulation code.

==================================================
29. PATHFINDING
==================================================

Pathfinding is a major technical risk.

Do not run expensive full map pathfinding independently for thousands of units every simulation tick.

Investigate a hierarchical system.

Possible architecture:

Strategic navigation:

sector graph

A star across sectors

Local navigation:

navigation mesh or grid

formation movement

flow fields

local steering

collision avoidance

Army movement can happen at two levels.

Level 1:

Strategic travel across the world.

Level 2:

Detailed local movement during battles and manoeuvring.

Create pathfinding performance benchmarks.

==================================================
30. FORMATIONS
==================================================

Eventually support:

line

column

wedge

box

spread

The first version may implement a simple formation.

Units moving together should receive distributed destination positions.

Do not have every unit attempt to occupy exactly the same coordinate.

==================================================
31. FOG OF WAR
==================================================

Players must not see everything.

Visibility can come from:

units

scouts

radar

observation structures

aircraft

sensors

The server determines visibility.

Do not send complete enemy state to clients and merely hide it visually.

That creates trivial cheats.

Filter server state according to player visibility.

==================================================
32. NETWORK INTEREST MANAGEMENT
==================================================

Do not constantly send the entire battlefield to every player.

Frequent updates are needed for:

player's own nearby forces

visible enemies

active battles

nearby buildings

local projectiles

important alerts

Distant sectors can update at a lower frequency.

Interest management can use:

sector

visibility

distance

ownership

active combat

strategic alerts

==================================================
33. BATTLE REPORTS
==================================================

Offline gameplay requires excellent reporting.

When a player returns they should see important events.

Examples:

attacks received

attacks launched

bases destroyed

units destroyed

units lost

buildings destroyed

territory captured

territory lost

resources captured

research completed

construction completed

respawn occurred

protection expired

A battle report may contain:

timestamp

location

attacker

defender

starting forces

losses

outcome

structures destroyed

territory changes

army destination

Future versions may provide full visual battle replay.

==================================================
34. OFFLINE FAIRNESS
==================================================

Do NOT make players invulnerable merely because they disconnected.

Otherwise players would disconnect deliberately when threatened.

Offline players:

can be attacked

remain active

have working defences

continue producing units

continue gathering resources

continue researching

continue construction

continue following standing army orders

Player online state must not create a direct combat advantage.

==================================================
35. PLAYER DESTRUCTION
==================================================

A player is NOT permanently eliminated when their army and base are completely destroyed.

Warfront 2140 is designed as a long running multiplayer war.

Someone should not be permanently excluded from a match lasting several days simply because they suffered one catastrophic defeat.

Define a state:

FORCE_DESTROYED

A player enters FORCE_DESTROYED when they no longer have a viable military or economic presence.

The exact rule must be configurable and defined centrally.

Initial definition may require:

no surviving buildings

no surviving production facilities

no surviving construction units

no surviving combat units

When FORCE_DESTROYED occurs:

record the destruction

generate battle reports

calculate statistics

clean up invalid state

begin respawn delay

determine safe respawn location

create a basic recovery base

activate temporary recovery protection

return the player to active gameplay

The player's identity does NOT change.

The player keeps:

account

match identity

faction

player colour

player symbol

statistics

battle history

completed research by default

Research retention should remain configurable.

For the initial game:

completed research survives respawning.

This prevents a player destroyed late in a week long match from returning technologically to day one.

==================================================
36. RESPAWN LOCATION
==================================================

A destroyed player automatically respawns somewhere else on the map.

The player must NOT choose an arbitrary new spawn position.

This prevents strategic teleportation.

The server chooses a relatively safe location.

The location should preferably be:

far from enemy headquarters

far from large enemy armies

far from active battles

far from heavily enemy controlled territory

far from the player who destroyed them

near enough to basic resources to allow rebuilding

suitable for base construction

away from other recently respawned players

Respawn location selection should use a scoring system.

Possible score inputs:

distanceFromNearestEnemyHQ

distanceFromNearestEnemyArmy

distanceFromActiveBattle

distanceFromHostileTerritory

nearbyResourceScore

terrainSuitability

distanceFromRecentRespawns

sectorSafetyScore

Choose the best valid candidate.

If no perfect area exists:

choose the safest valid location available.

Maps must contain sufficient potential recovery regions.

==================================================
37. RESPAWN BASE
==================================================

A respawning player receives only a basic recovery base.

Example recovery package:

1 Headquarters

1 basic Resource Processor

1 Power Generator if required

1 basic Factory

1 Engineer or construction vehicle

small amount of Materials

small amount of Energy

optional basic defensive turret

Do NOT restore the player's previous army.

Do NOT restore destroyed buildings.

Do NOT return lost territory.

The objective is to give the player a foothold.

They still suffered a major strategic defeat.

Respawn configuration must be data driven.

For example:

respawnDelay

respawnProtectionDuration

startingMaterials

startingEnergy

startingBuildings

startingUnits

==================================================
38. TERRITORY AFTER DESTRUCTION
==================================================

A player's previous territory is NOT restored after respawning.

Previously controlled territory:

remains under whoever captured it

becomes neutral if appropriate

remains contested according to normal rules

Respawning creates a completely new foothold somewhere else.

This makes destruction strategically meaningful.

Example:

A player may dominate half the map.

Enemy forces destroy that player's military and bases.

The defeated player later respawns in a distant mountain region.

They retain technology and identity, but must rebuild their economy and military.

Their former territory remains lost.

==================================================
39. RESPAWN PROTECTION
==================================================

A respawned player receives temporary rebuilding protection.

Purpose:

prevent another army immediately destroying the recovery base.

Protection must be configurable.

During protection:

enemy players cannot attack protected structures

enemy players cannot attack protected units inside the designated recovery zone

the player can construct

the player can gather resources

the player can manufacture

the player can research

the player can organise forces

Protection must NOT become an offensive exploit.

Possible rules:

If the protected player attacks another player:

protection ends immediately.

If a protected military force leaves the protected recovery zone:

protection may end.

If protected forces intentionally interfere with another player's operations:

protection may end.

Display clearly:

that the player is protected

their recovery zone

time remaining

Protection continues whether the player is online or offline.

Disconnecting does not pause protection.

==================================================
40. RESPAWN EXPLOIT PREVENTION
==================================================

Respawning must never become strategically beneficial compared with surviving.

Prevent players deliberately destroying themselves in order to:

teleport across the map

gain free resources

escape enemy armies

gain a better starting position

refresh damaged units

reset production

duplicate resources

Potential protections:

respawn delay

server chosen location

limited recovery resources

destroyed production queues remain destroyed

no free major army

no free advanced buildings

statistics record number of destructions

possible increasing respawn delay after repeated destruction

Do not necessarily implement increasing penalties initially.

Make the system configurable so they can be added later.

==================================================
41. INITIAL MATCH PROTECTION
==================================================

At the beginning of a match players receive a temporary protection period.

This prevents immediate rushing before players have a functional economy.

Starting protection should be configurable.

Starting protection and respawn protection may use the same general protection system.

==================================================
42. VICTORY CONDITIONS
==================================================

Because players can respawn, destroying a base does not automatically win the match.

Warfront 2140 should primarily use strategic victory conditions.

Support configurable victory modes.

DOMINATION

Control a configured percentage of important territory continuously for a configured period.

Example:

Control 70 percent of strategic sectors for 12 real world hours.

CENTRAL OBJECTIVE

Capture and continuously control one or more major strategic facilities.

Example:

Control the Central Command Complex for 24 hours.

SUPREMACY

Accumulate victory points.

Possible victory point sources:

territory control

base destruction

army destruction

strategic objectives

resource facilities

major battles

TOTAL CONTROL

Control all required strategic command regions simultaneously.

Future optional mode:

LIMITED LIVES

Players have a limited number of respawns.

After using the final respawn they are eliminated.

This should NOT be the default mode.

Default Warfront 2140 rules should allow recovery from destruction.

==================================================
43. ANTI STALEMATE DESIGN
==================================================

Matches must eventually end.

Avoid situations where players hide indefinitely.

Mechanics that may reduce stalemates:

strategic objectives

victory points

territory requirements

central objectives

increasing resource pressure

limited strategic resources

map events

Do not implement arbitrary forced endings unless necessary.

==================================================
44. ECONOMIC CONSEQUENCES OF DEFEAT
==================================================

Respawning prevents exclusion from the match.

It must not remove the consequences of defeat.

A destroyed player loses:

their existing army

their existing base

their production capacity

their previous resource infrastructure

their controlled territory

their strategic map position

possibly unspent resources, depending on configured rules

They keep:

player identity

faction

player colour

battle history

statistics

completed research by default

This creates a comeback opportunity without making defeat meaningless.

==================================================
45. AUTHENTICATION
==================================================

Initial account system:

username

email

password

Passwords must be securely hashed.

Use established security libraries.

Do not invent custom cryptography.

Account contains:

id

username

email

createdAt

statistics

match history

==================================================
46. LOBBY
==================================================

Players can:

create match

join match

invite friends

select faction

select or receive colour

see connected players

ready up

Support invite codes.

Example:

WF2140 ABC123

Host can configure:

maximum players

map

match pacing

initial protection duration

respawn protection duration

respawn delay

victory conditions

==================================================
47. MATCH SPEED
==================================================

Support different pacing presets.

Examples:

RAPID

STANDARD

EPIC

STANDARD should be the first default.

Do not hardcode timing values.

Construction, research, travel and production times should use configuration.

==================================================
48. DATABASE MODEL
==================================================

Design PostgreSQL tables for at least:

users

matches

match_players

sectors

bases

buildings

units

armies

army_units

commands

research

game_events

battle_reports

world_snapshots

scheduled_events

player_protection

respawn_events

Possible match_players fields:

id

match_id

user_id

faction_id

player_colour

player_symbol

state

respawn_count

protection_until

created_at

Do not write unit coordinates into PostgreSQL every simulation tick.

Active world state should primarily live in memory.

Persist snapshots periodically.

Persist important irreversible events reliably.

==================================================
49. ADMINISTRATION
==================================================

Provide development administration tools.

Examples:

create match

start match

pause match

resume match

finish match

inspect player

inspect army

inspect sector

teleport development unit

trigger snapshot

simulate destruction

trigger respawn

advance simulation clock in development

These tools are for testing and development.

==================================================
50. SECURITY
==================================================

Assume clients may be malicious.

Validate every input.

Use schema validation.

Use rate limiting.

Never expose database credentials.

Use environment variables.

Prevent players from:

commanding other players' units

changing their own resources

changing health

changing positions directly

viewing hidden enemy information

choosing invalid respawn positions

changing player protection

fabricating battle results

==================================================
51. PERFORMANCE TARGETS
==================================================

Long term target:

10 simultaneous players

approximately 200 to 500 units per player

approximately 2,000 to 5,000 units in a large match

Do NOT assume this target will automatically work.

Benchmark continuously.

Measure:

simulation tick duration

pathfinding time

CPU usage

memory usage

network bandwidth

WebSocket message rates

snapshot duration

database latency

visible units per client

active combat count

Optimise based on measurements.

==================================================
52. LOCAL HOSTING
==================================================

The game must be straightforward to run locally.

Target developer workflow:

git clone repository

copy environment file

run:

docker compose up

Then open the application in the browser.

Docker Compose should provide:

client

server

postgresql

Development may use hot reload.

Provide clear README instructions.

==================================================
53. FRIENDS PLAYING ON LOCAL HOST
==================================================

Local development should allow multiplayer testing.

Initial supported environments:

same machine

local network

private VPN such as Tailscale

future public Internet hosting

Do not tightly couple the game to a specific tunnelling provider.

==================================================
54. DIGITALOCEAN DEPLOYMENT
==================================================

Design the containers so the same application can later run on an Ubuntu DigitalOcean Droplet.

Possible initial production setup:

Caddy or Nginx

HTTPS

client container

server container

PostgreSQL

WebSockets

Persistent storage

Managed PostgreSQL may be considered later.

Do not design game logic around DigitalOcean specific APIs.

Hosting must remain portable.

==================================================
55. OPEN SOURCE DEVELOPMENT
==================================================

The project will be hosted on GitHub.

Multiple developers may contribute.

Create:

README.md

CONTRIBUTING.md

ARCHITECTURE.md

GAME_DESIGN.md

SECURITY.md

Use pull requests.

Prepare GitHub Actions.

CI should perform:

dependency installation

lint

format checking

type checking

unit tests

integration tests where reasonable

build

Do not automatically deploy to production until deployment is stable.

==================================================
56. CODING STANDARDS
==================================================

Use strict TypeScript.

Avoid any.

Use clear domain types.

Separate rendering from simulation.

Separate networking from simulation.

Separate persistence from simulation.

Avoid giant manager classes.

Do not create one enormous Game.ts.

Use configuration rather than magic numbers.

Use structured logging.

Handle errors explicitly.

Document major architectural decisions.

==================================================
57. ART
==================================================

Do not block development on final artwork.

Use simple original placeholder assets initially.

Examples:

simple tanks

simple buildings

simple walkers

simple creatures

simple robots

Models can use basic geometry during development.

Preferred production asset format:

glTF

GLB

Models should support player colour masks.

Game logic must not depend on a particular model.

Replacing art should not require rewriting combat logic.

==================================================
58. AUDIO
==================================================

Audio is not a first milestone priority.

Future audio:

weapon sounds

vehicle sounds

creature sounds

construction

alerts

battle ambience

faction identity sounds

Do not use copyrighted audio.

==================================================
59. USER INTERFACE
==================================================

Eventually provide:

main menu

login

player profile

match browser

create match

join match

lobby

faction selection

colour selection

game HUD

resource display

unit information

army information

construction menu

research menu

minimap

alerts

battle reports

respawn status

protection timer

match victory information

Prioritise usability first.

Visual polish comes later.

==================================================
60. MINIMAP
==================================================

The minimap should eventually show:

terrain

friendly units

known enemy units

territory ownership

battle alerts

strategic objectives

protected recovery zones

Respect fog of war.

==================================================
61. PLAYER NOTIFICATIONS
==================================================

Important events should create notifications.

Examples:

Your base is under attack.

Army Alpha entered enemy territory.

Research completed.

Factory completed.

Sector lost.

Sector captured.

Enemy headquarters destroyed.

Your entire force has been destroyed.

Respawn scheduled.

New recovery base established.

Protection expires in one hour.

A player has entered victory pending state.

==================================================
62. INITIAL VERTICAL SLICE
==================================================

DO NOT attempt the complete game immediately.

Build a meaningful vertical slice.

Initial version should contain:

one map

two players

architecture supporting 10 players

two factions

different player colours even when using same faction

one headquarters per player

one resource

one resource facility

one factory

three unit types

Scout

Medium Assault

Artillery

unit selection

unit movement

basic pathfinding

basic combat

building construction

unit production

server authoritative simulation

territory sectors

persistent match state

disconnect and reconnect

offline army movement

offline battle resolution

battle reports

world snapshot recovery

basic FORCE_DESTROYED detection

automatic respawn

safe respawn location

basic recovery base

respawn protection

simple victory condition

==================================================
63. MILESTONE 0
==================================================

Architecture and scaffolding.

Create monorepo.

Create Docker development environment.

Configure PostgreSQL.

Create shared types.

Create simulation package.

Create server.

Create basic Babylon.js client.

Create CI.

Create documentation.

Acceptance criteria:

docker compose up works

client opens

server health endpoint works

database connection works

tests run

type checking passes

lint passes

README explains setup

==================================================
64. MILESTONE 1
==================================================

Single player simulation prototype.

Create basic terrain.

Create camera.

Create one unit.

Select unit.

Move unit.

Server calculates movement.

Client renders movement.

Acceptance criteria:

server is authoritative

refreshing browser restores state

==================================================
65. MILESTONE 2
==================================================

Multiplayer.

Run two browser sessions.

Create two players.

Assign different player colours.

Allow same faction with different colours.

Players see shared battlefield.

Players can only command their own units.

Acceptance criteria:

both clients see consistent state

player A cannot control player B

unit ownership is server validated

player colours render correctly

==================================================
66. MILESTONE 3
==================================================

Combat.

Implement:

weapons

health

damage

death

medium assault

artillery

Acceptance criteria:

server calculates damage

client displays combat

destroyed units remain destroyed after reconnect

==================================================
67. MILESTONE 4
==================================================

Economy.

Implement:

resource node

resource facility

factory

unit production

construction timers

Acceptance criteria:

production continues after disconnect

reconnecting displays correct progress

==================================================
68. MILESTONE 5
==================================================

Persistence.

Implement:

world snapshots

scheduled events

restart recovery

Acceptance test:

begin construction

stop server

restart server

world restores

construction restores

army orders restore

==================================================
69. MILESTONE 6
==================================================

Offline armies.

Implement:

army groups

attack order

defend order

standing orders

retreat threshold

Acceptance test:

Player A orders attack.

Player A disconnects.

Army continues moving.

Army reaches target.

Combat occurs.

Player A reconnects.

Correct battlefield exists.

Correct battle report exists.

==================================================
70. MILESTONE 7
==================================================

Player destruction and respawn.

Implement:

FORCE_DESTROYED

respawn delay

respawn candidate evaluation

safe respawn selection

basic recovery base

respawn protection

territory remains lost

Acceptance test:

Player A destroys every viable unit and building owned by Player B.

Server detects FORCE_DESTROYED.

Battle report is generated.

Respawn event is scheduled.

After configured delay:

server chooses distant safe location

basic base is created

Player B retains faction

Player B retains colour

Player B retains research

Player B does not regain previous territory

Player B receives recovery protection

Player A cannot immediately destroy protected base

Server restart during respawn does not lose the timer.

==================================================
71. MILESTONE 8
==================================================

Large map architecture.

Implement:

sectors

territory ownership

strategic pathfinding

local movement

fog of war

interest management

==================================================
72. MILESTONE 9
==================================================

Faction system.

Implement initial faction abstraction.

Start with:

Imperial Vanguard

Iron Battalion

Later add:

Wildborn Clans

Nexus Collective

Verify that multiple players can use identical factions with different colours.

==================================================
73. MILESTONE 10
==================================================

Victory conditions.

Implement at least:

DOMINATION

or

CENTRAL OBJECTIVE

Do not make base destruction automatically end the match.

Implement VICTORY_PENDING.

Example:

Player controls required territory.

Timer starts.

If territory is lost before timer completes:

victory timer cancels.

If condition remains satisfied:

winner declared.

==================================================
74. MILESTONE 11
==================================================

10 player testing.

Load test:

10 connected players

hundreds of units

multiple battles

offline armies

multiple respawns

large territory changes

Measure:

CPU

RAM

tick time

network traffic

pathfinding cost

snapshot cost

Optimise based on measured bottlenecks.

==================================================
75. OFFLINE SIMULATION AUTOMATED TESTS
==================================================

Create automated tests for:

player orders attack

player disconnects

army travels

enemy detected

combat begins

combat completes

territory changes

battle report generated

player reconnects

correct state returned

Also test server restart during:

movement

construction

research

combat

respawn delay

respawn protection

victory pending timer

==================================================
76. RESPAWN AUTOMATED TESTS
==================================================

Test:

complete player destruction

FORCE_DESTROYED detection

respawn scheduled

safe location calculation

no enemy nearby

basic buildings created

resources granted once

research retained

colour retained

faction retained

old territory not restored

temporary protection activated

protection expires correctly

attacking cancels protection if configured

player cannot exploit respawn for duplicate resources

restart restores respawn state

==================================================
77. COLOUR SYSTEM TESTS
==================================================

Test:

two players select same faction

player colours differ

colour data survives reconnect

colour data survives server restart

unit colour masks render correctly

territory colours remain identifiable

no two active players receive identical colours

==================================================
78. RANDOMNESS
==================================================

Use seeded randomness where possible.

Store seeds for important battles or procedural systems.

This supports:

debugging

tests

replays

reproduction of bugs

==================================================
79. LOGGING
==================================================

Use structured logs.

Important log events:

player connected

player disconnected

match created

match started

command submitted

command accepted

command rejected

army movement started

battle started

battle completed

building completed

research completed

sector captured

player destroyed

respawn scheduled

respawn completed

protection started

protection cancelled

protection expired

snapshot created

snapshot restored

victory pending

match won

Never log:

passwords

tokens

secrets

==================================================
80. OBSERVABILITY
==================================================

Prepare for basic metrics.

Possible metrics:

active players

connected clients

active matches

units simulated

armies active

active battles

simulation tick time

commands per second

WebSocket bandwidth

pathfinding duration

database latency

snapshot time

respawn events

Do not introduce heavy monitoring infrastructure initially.

==================================================
81. IMPORTANT DESIGN PRINCIPLES
==================================================

Always preserve these principles:

server authoritative

persistent simulation

offline capable gameplay

browser accessible

easy local hosting

easy DigitalOcean hosting

open source friendly

data driven factions

multiple players can use same faction

unique player colours

long running matches

player destruction causes major setback but not permanent exclusion

safe automatic respawning

strategic territorial warfare

modular architecture

simulation independent of rendering

network independent simulation

testable game clock

measured optimisation

==================================================
82. THINGS NOT TO DO
==================================================

Do NOT:

create the game in one huge source file

mix Babylon.js into simulation code

trust client coordinates

trust client combat results

use PostgreSQL as the real time game loop

persist every simulation frame

create completely separate engines for each faction

copy copyrighted game assets

copy recognisable franchise vehicles

make offline players immune

make respawning players permanently invulnerable

allow players to manually choose exploitative respawn locations

restore all lost territory after respawning

give respawning players a full army

require Redis initially

require Kubernetes

create unnecessary cloud dependencies

optimise for millions of users

prematurely distribute the system into microservices

The first target is an excellent game for approximately 10 friends.

==================================================
83. FUTURE FEATURES
==================================================

Do not implement these immediately.

Design architecture so they remain possible.

spectator mode

battle replay

procedural maps

AI opponents

community maps

community factions

custom faction creation

native desktop version

mobile companion interface

server browser

private servers

public servers

ranked matchmaking

teams

alliances

diplomacy

trading

temporary treaties

cooperative gameplay

seasonal scenarios

map editor

modding tools

faction workshop

custom unit skins

custom player symbols

advanced accessibility

==================================================
84. GAMEPLAY PHILOSOPHY
==================================================

Warfront 2140 should reward strategic planning rather than requiring constant attention.

A player should be able to spend:

10 minutes

30 minutes

one hour

or several hours

managing their war.

Then they can disconnect.

Their plans continue.

Being online allows detailed tactical control.

Being offline relies on standing orders and automation.

Being online should be advantageous because humans can adapt more intelligently.

Being offline should not make the player's forces helpless.

==================================================
85. COMEBACK PHILOSOPHY
==================================================

A catastrophic defeat should hurt.

It should not permanently remove somebody from a week long match.

Example:

Player Blue controls a large empire on Monday.

Player Red launches a major offensive overnight.

By Tuesday morning:

Blue's headquarters is destroyed.

Blue's factories are destroyed.

Blue's armies are destroyed.

Blue loses their territory.

Blue enters FORCE_DESTROYED.

After the respawn delay:

Blue receives a small base in a remote region.

Blue retains previously researched technology.

Blue receives limited temporary protection.

Blue rebuilds.

By Thursday Blue may have formed another army.

By Friday Blue may return to the war.

This type of evolving narrative is desirable.

==================================================
86. FIRST TASK FOR CODEX
==================================================

DO NOT immediately implement the entire specification.

First:

Review this document critically.

Identify:

architectural risks

contradictions

technical risks

scalability concerns

security concerns

multiplayer concerns

gameplay problems

possible respawn exploits

offline gameplay problems

network risks

persistence risks

pathfinding risks

Then propose:

final architecture

repository structure

domain model

database model

simulation architecture

game clock design

network protocol design

persistence strategy

snapshot strategy

restart recovery strategy

pathfinding strategy

sector system

faction system

player colour system

respawn algorithm

protection system

victory condition architecture

Docker development environment

testing strategy

implementation roadmap

Do not assume every idea in this specification is technically optimal.

Challenge decisions when appropriate.

Explain the tradeoffs briefly.

After presenting the architectural review:

WAIT FOR APPROVAL BEFORE IMPLEMENTING MILESTONE 0.

Once implementation begins:

run tests

run type checking

run linting

run builds

fix errors before declaring work complete

Do not claim something works unless it has actually been tested.

Prefer simple, reliable architecture over clever complexity.

The goal is not to generate the maximum amount of code.

The goal is to build Warfront 2140 properly.
```

</details>
