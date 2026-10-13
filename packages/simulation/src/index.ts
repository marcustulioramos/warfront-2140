import type { MoveUnitCommand } from "@warfront/protocol";
import type { Point, UnitView, WorldView } from "@warfront/shared";

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
  readonly lastSimulatedAtMs: number;
}

export class Simulation {
  private world: WorldSnapshot;
  constructor(
    private readonly clock: Clock,
    snapshot?: WorldSnapshot,
  ) {
    this.world = snapshot ?? {
      matchId: "development",
      tick: 0,
      lastSimulatedAtMs: clock.nowMs(),
      units: [
        {
          id: "unit-1",
          ownerId: "player-1",
          position: { x: 0, z: 0 },
          destination: null,
        },
      ],
    };
  }
  snapshot(): WorldSnapshot {
    return structuredClone(this.world);
  }
  command(playerId: string, command: MoveUnitCommand): void {
    const unit = this.world.units.find((item) => item.id === command.unitId);
    if (!unit || unit.ownerId !== playerId)
      throw new Error("Unit is not owned by player");
    const destination = command.destination;
    if (Math.abs(destination.x) > 100 || Math.abs(destination.z) > 100)
      throw new Error("Destination outside map");
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
    const units: UnitView[] = this.world.units
      .map((unit) => ({
        ...unit,
        position: moveTowards(
          unit.position,
          unit.destination,
          deltaSeconds * 5,
        ),
      }))
      .map((unit) => ({
        ...unit,
        destination:
          unit.destination && distance(unit.position, unit.destination) < 0.001
            ? null
            : unit.destination,
      }));
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
