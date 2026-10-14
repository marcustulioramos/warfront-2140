import type { ClientCommand } from "@warfront/protocol";
import { snapshotVersion } from "@warfront/protocol";
import {
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
          lastSimulatedAtMs: clock.nowMs(),
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
        };
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
    const deltaMs = Math.max(
      0,
      Math.min(now - this.world.lastSimulatedAtMs, 1000),
    );
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
