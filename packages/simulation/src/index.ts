import type { ClientCommand } from "@warfront/protocol";
import { snapshotVersion } from "@warfront/protocol";
import {
  ECONOMY,
  UNIT_STATS,
  WORLD_HALF_SIZE,
  type CombatEvent,
  type Point,
  type UnitRole,
  type UnitView,
  type WorldView,
} from "@warfront/shared";

export interface Clock {
  nowMs(): number;
}

export class ManualClock implements Clock {
  constructor(private currentMs = 0) {}
  nowMs(): number {
    return this.currentMs;
  }
  advanceBy(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("Invalid duration");
    this.currentMs += ms;
  }
}

export class RealClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
}

export interface WorldSnapshot extends WorldView {
  readonly snapshotVersion: typeof snapshotVersion;
  readonly lastSimulatedAtMs: number;
}
export function startingEconomy(
  playerIds: readonly string[],
): Pick<WorldView, "resourceNodes" | "buildings" | "production" | "resources"> {
  return {
    resourceNodes: playerIds.map((id, index) => ({
      id: `node-${id}`,
      position: { x: index === 0 ? -14 : 14, z: -10 },
    })),
    buildings: [],
    production: [],
    resources: playerIds.map((playerId) => ({
      playerId,
      ore: ECONOMY.startingOre,
    })),
  };
}

function makeUnit(
  id: string,
  ownerId: string,
  role: UnitRole,
  position: Point,
): UnitView {
  const stats = UNIT_STATS[role];
  return {
    id,
    ownerId,
    role,
    position,
    destination: null,
    targetId: null,
    health: stats.maxHealth,
    maxHealth: stats.maxHealth,
    cooldownMs: 0,
  };
}

export class Simulation {
  private world: WorldSnapshot;

  constructor(
    private readonly clock: Clock,
    snapshot?: WorldSnapshot,
    matchId?: string,
  ) {
    this.world = snapshot
      ? {
          ...structuredClone(snapshot),
          lastSimulatedAtMs: snapshot.lastSimulatedAtMs,
          combatEvents: [],
        }
      : {
          snapshotVersion,
          matchId: matchId ?? "development",
          tick: 0,
          lastSimulatedAtMs: clock.nowMs(),
          playerIds: matchId ? [] : ["player-1"],
          units: matchId
            ? []
            : [makeUnit("unit-1", "player-1", "scout", { x: 0, z: 0 })],
          combatEvents: [],
          ...startingEconomy(matchId ? [] : ["player-1"]),
        };
    if (snapshot) this.settleEconomy(clock.nowMs());
  }

  snapshot(): WorldSnapshot {
    return structuredClone(this.world);
  }

  addPlayer(playerId: string): WorldSnapshot {
    if (this.world.playerIds.includes(playerId)) return this.snapshot();
    if (this.world.playerIds.length >= 2) throw new Error("Match is full");
    const x = this.world.playerIds.length === 0 ? -10 : 10;
    this.world = {
      ...this.world,
      playerIds: [...this.world.playerIds, playerId],
      resourceNodes: [
        ...this.world.resourceNodes,
        {
          id: `node-${playerId}`,
          position: { x: this.world.playerIds.length === 0 ? -14 : 14, z: -10 },
        },
      ],
      resources: [
        ...this.world.resources,
        { playerId, ore: ECONOMY.startingOre },
      ],
      units: [
        ...this.world.units,
        makeUnit(`unit-${playerId}`, playerId, "scout", { x, z: 0 }),
        makeUnit(`medium-${playerId}`, playerId, "medium", { x, z: -4 }),
        makeUnit(`artillery-${playerId}`, playerId, "artillery", { x, z: 4 }),
      ],
    };
    return this.snapshot();
  }

  command(playerId: string, command: ClientCommand): void {
    if (command.type === "BUILD_STRUCTURE") {
      this.build(playerId, command.kind, command.nodeId);
      return;
    }
    if (command.type === "PRODUCE_UNIT") {
      this.produce(
        playerId,
        command.factoryId,
        command.role,
        command.commandId,
      );
      return;
    }
    const unit = this.world.units.find((item) => item.id === command.unitId);
    if (!unit || unit.ownerId !== playerId)
      throw new Error("Unit is not owned by player");
    if (command.type === "MOVE_UNIT") {
      const destination = command.destination;
      if (
        Math.abs(destination.x) > WORLD_HALF_SIZE ||
        Math.abs(destination.z) > WORLD_HALF_SIZE
      )
        throw new Error("Destination outside map");
      this.world = {
        ...this.world,
        units: this.world.units.map((item) =>
          item.id === command.unitId
            ? { ...item, destination, targetId: null }
            : item,
        ),
      };
    } else {
      const target = this.world.units.find(
        (item) => item.id === command.targetId,
      );
      if (!target || target.ownerId === playerId)
        throw new Error("Invalid enemy target");
      this.world = {
        ...this.world,
        units: this.world.units.map((item) =>
          item.id === command.unitId
            ? { ...item, destination: null, targetId: target.id }
            : item,
        ),
      };
    }
  }

  advance(): WorldSnapshot {
    const now = this.clock.nowMs();
    const previousTime = this.world.lastSimulatedAtMs;
    this.settleEconomy(now);
    const deltaMs = Math.max(0, Math.min(now - previousTime, 1000));
    const original = new Map(this.world.units.map((unit) => [unit.id, unit]));
    const moved: UnitView[] = this.world.units.map((unit) => {
      const stats = UNIT_STATS[unit.role];
      const target = unit.targetId ? original.get(unit.targetId) : undefined;
      let position = unit.position;
      let destination = unit.destination;
      let targetId = unit.targetId;
      if (target && target.ownerId !== unit.ownerId) {
        const remaining = Math.max(
          0,
          distance(position, target.position) - stats.range * 0.9,
        );
        position = moveTowards(
          position,
          target.position,
          Math.min(remaining, (stats.speed * deltaMs) / 1000),
        );
      } else if (unit.targetId) {
        targetId = null;
      } else if (destination) {
        position = moveTowards(
          position,
          destination,
          (stats.speed * deltaMs) / 1000,
        );
        if (distance(position, destination) < 0.001) destination = null;
      }
      return {
        ...unit,
        position,
        destination,
        targetId,
        cooldownMs: Math.max(0, unit.cooldownMs - deltaMs),
      };
    });

    const byId = new Map(moved.map((unit) => [unit.id, unit]));
    const damage = new Map<string, number>();
    const rawEvents: Omit<CombatEvent, "destroyed">[] = [];
    const fired = new Set<string>();
    for (const unit of moved) {
      if (!unit.targetId || unit.cooldownMs > 0 || deltaMs === 0) continue;
      const target = byId.get(unit.targetId);
      if (!target || target.ownerId === unit.ownerId) continue;
      const stats = UNIT_STATS[unit.role];
      if (distance(unit.position, target.position) > stats.range) continue;
      damage.set(target.id, (damage.get(target.id) ?? 0) + stats.damage);
      rawEvents.push({
        attackerId: unit.id,
        targetId: target.id,
        from: unit.position,
        to: target.position,
        damage: stats.damage,
      });
      fired.add(unit.id);
    }
    const damaged = moved.map((unit) => ({
      ...unit,
      health: Math.max(0, unit.health - (damage.get(unit.id) ?? 0)),
      cooldownMs: fired.has(unit.id)
        ? UNIT_STATS[unit.role].reloadMs
        : unit.cooldownMs,
    }));
    const alive = new Set(
      damaged.filter((unit) => unit.health > 0).map((unit) => unit.id),
    );
    const combatEvents: CombatEvent[] = rawEvents.map((event) => ({
      ...event,
      destroyed: !alive.has(event.targetId),
    }));
    this.world = {
      ...this.world,
      tick: this.world.tick + 1,
      lastSimulatedAtMs: now,
      units: damaged
        .filter((unit) => unit.health > 0)
        .map((unit) =>
          unit.targetId && !alive.has(unit.targetId)
            ? { ...unit, targetId: null }
            : unit,
        ),
      combatEvents,
    };
    return this.snapshot();
  }

  private spend(playerId: string, cost: number): void {
    const balance = this.world.resources.find(
      (item) => item.playerId === playerId,
    );
    if (!balance || balance.ore < cost) throw new Error("Insufficient ore");
    this.world = {
      ...this.world,
      resources: this.world.resources.map((item) =>
        item.playerId === playerId ? { ...item, ore: item.ore - cost } : item,
      ),
    };
  }

  private build(
    playerId: string,
    kind: "extractor" | "factory",
    nodeId: string | null,
  ): void {
    if (!this.world.playerIds.includes(playerId))
      throw new Error("Player is not in match");
    const existing = this.world.buildings.find(
      (item) => item.ownerId === playerId && item.kind === kind,
    );
    if (existing) throw new Error("Building already exists");
    const node = this.world.resourceNodes.find((item) => item.id === nodeId);
    if (kind === "extractor" && (!node || node.id !== `node-${playerId}`))
      throw new Error("Invalid resource node");
    if (kind === "factory" && nodeId !== null)
      throw new Error("Factory does not use a node");
    this.spend(
      playerId,
      kind === "extractor" ? ECONOMY.extractorCost : ECONOMY.factoryCost,
    );
    const index = this.world.playerIds.indexOf(playerId);
    const position =
      kind === "extractor"
        ? node!.position
        : { x: index === 0 ? -12 : 12, z: 10 };
    this.world = {
      ...this.world,
      buildings: [
        ...this.world.buildings,
        {
          id: `${kind}-${playerId}`,
          ownerId: playerId,
          kind,
          position,
          nodeId: kind === "extractor" ? nodeId : null,
          readyAtMs:
            this.clock.nowMs() +
            (kind === "extractor"
              ? ECONOMY.extractorBuildMs
              : ECONOMY.factoryBuildMs),
        },
      ],
    };
  }

  private produce(
    playerId: string,
    factoryId: string,
    role: UnitRole,
    jobId: string,
  ): void {
    if (
      this.world.production.some((job) => job.id === jobId) ||
      this.world.units.some((unit) => unit.id === `produced-${jobId}`)
    )
      throw new Error("Production command already used");
    const factory = this.world.buildings.find(
      (item) =>
        item.id === factoryId &&
        item.ownerId === playerId &&
        item.kind === "factory",
    );
    if (!factory || factory.readyAtMs > this.clock.nowMs())
      throw new Error("Factory is not ready");
    if (this.world.production.some((job) => job.factoryId === factoryId))
      throw new Error("Factory is busy");
    this.spend(playerId, ECONOMY.unitCost[role]);
    this.world = {
      ...this.world,
      production: [
        ...this.world.production,
        {
          id: jobId,
          ownerId: playerId,
          role,
          factoryId,
          readyAtMs: this.clock.nowMs() + ECONOMY.unitBuildMs[role],
        },
      ],
    };
  }

  private settleEconomy(now: number): void {
    const from = this.world.lastSimulatedAtMs;
    if (now <= from) return;
    const resources = this.world.resources.map((balance) => {
      const extractor = this.world.buildings.find(
        (item) =>
          item.ownerId === balance.playerId && item.kind === "extractor",
      );
      const activeMs = extractor
        ? Math.max(0, now - Math.max(from, extractor.readyAtMs))
        : 0;
      return {
        ...balance,
        ore: balance.ore + (activeMs * ECONOMY.orePerSecond) / 1000,
      };
    });
    const completed = this.world.production.filter(
      (job) => job.readyAtMs <= now,
    );
    const units = [
      ...this.world.units,
      ...completed.map((job) => {
        const factory = this.world.buildings.find(
          (item) => item.id === job.factoryId,
        )!;
        return makeUnit(`produced-${job.id}`, job.ownerId, job.role, {
          x: factory.position.x,
          z: factory.position.z + 3,
        });
      }),
    ];
    this.world = {
      ...this.world,
      resources,
      units,
      production: this.world.production.filter((job) => job.readyAtMs > now),
      lastSimulatedAtMs: now,
    };
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function moveTowards(
  position: Point,
  destination: Point,
  maxDistance: number,
): Point {
  const remaining = distance(position, destination);
  if (remaining <= maxDistance) return destination;
  if (remaining === 0) return position;
  return {
    x: position.x + ((destination.x - position.x) * maxDistance) / remaining,
    z: position.z + ((destination.z - position.z) * maxDistance) / remaining,
  };
}
