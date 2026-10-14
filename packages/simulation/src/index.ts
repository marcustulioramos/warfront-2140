import type { MoveUnitCommand } from "@warfront/protocol";
import { snapshotVersion } from "@warfront/protocol";
import {
  WORLD_HALF_SIZE,
  type Point,
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

export class Simulation {
  private world: WorldSnapshot;

  constructor(
    private readonly clock: Clock,
    snapshot?: WorldSnapshot,
    matchId?: string,
  ) {
    this.world = snapshot
      ? { ...structuredClone(snapshot), lastSimulatedAtMs: clock.nowMs() }
      : {
          snapshotVersion,
          matchId: matchId ?? "development",
          tick: 0,
          lastSimulatedAtMs: clock.nowMs(),
          units: matchId
            ? []
            : [
                {
                  id: "unit-1",
                  ownerId: "player-1",
                  position: { x: 0, z: 0 },
                  destination: null,
                },
              ],
        };
  }

  addPlayer(playerId: string): WorldSnapshot {
    if (this.world.units.some((unit) => unit.ownerId === playerId))
      return this.snapshot();
    if (this.world.units.length >= 2) throw new Error("Match is full");
    const x = this.world.units.length === 0 ? -10 : 10;
    this.world = {
      ...this.world,
      units: [
        ...this.world.units,
        {
          id: `unit-${playerId}`,
          ownerId: playerId,
          position: { x, z: 0 },
          destination: null,
        },
      ],
    };
    return this.snapshot();
  }

  snapshot(): WorldSnapshot {
    return structuredClone(this.world);
  }

  command(playerId: string, command: MoveUnitCommand): void {
    const unit = this.world.units.find((item) => item.id === command.unitId);
    if (!unit || unit.ownerId !== playerId)
      throw new Error("Unit is not owned by player");
    const destination = command.destination;
    if (
      Math.abs(destination.x) > WORLD_HALF_SIZE ||
      Math.abs(destination.z) > WORLD_HALF_SIZE
    ) {
      throw new Error("Destination outside map");
    }
    this.world = {
      ...this.world,
      units: this.world.units.map((item) =>
        item.id === command.unitId ? { ...item, destination } : item,
      ),
    };
  }

  advance(): WorldSnapshot {
    const now = this.clock.nowMs();
    const deltaSeconds = Math.max(
      0,
      Math.min((now - this.world.lastSimulatedAtMs) / 1000, 1),
    );
    const units: UnitView[] = this.world.units.map((unit) => {
      const position = moveTowards(
        unit.position,
        unit.destination,
        deltaSeconds * 5,
      );
      return {
        ...unit,
        position,
        destination:
          unit.destination && distance(position, unit.destination) < 0.001
            ? null
            : unit.destination,
      };
    });
    this.world = {
      ...this.world,
      tick: this.world.tick + 1,
      lastSimulatedAtMs: now,
      units,
    };
    return this.snapshot();
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function moveTowards(
  position: Point,
  destination: Point | null,
  maxDistance: number,
): Point {
  if (!destination) return position;
  const remaining = distance(position, destination);
  if (remaining <= maxDistance) return destination;
  return {
    x: position.x + ((destination.x - position.x) * maxDistance) / remaining,
    z: position.z + ((destination.z - position.z) * maxDistance) / remaining,
  };
}
