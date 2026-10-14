export type MatchId = string;
export type PlayerId = string;
export type UnitId = string;

export const WORLD_HALF_SIZE = 20;

export const UNIT_STATS = {
  scout: {
    weapon: "Pulse carbine",
    maxHealth: 45,
    damage: 7,
    range: 6,
    reloadMs: 800,
    speed: 6,
  },
  medium: {
    weapon: "Kinetic cannon",
    maxHealth: 100,
    damage: 15,
    range: 7,
    reloadMs: 1200,
    speed: 3.5,
  },
  artillery: {
    weapon: "Siege mortar",
    maxHealth: 60,
    damage: 25,
    range: 12,
    reloadMs: 2500,
    speed: 2,
  },
} as const;

export type UnitRole = keyof typeof UNIT_STATS;

export interface Point {
  readonly x: number;
  readonly z: number;
}

export interface UnitView {
  readonly id: UnitId;
  readonly ownerId: PlayerId;
  readonly role: UnitRole;
  readonly position: Point;
  readonly destination: Point | null;
  readonly targetId: UnitId | null;
  readonly health: number;
  readonly maxHealth: number;
  readonly cooldownMs: number;
}

export interface CombatEvent {
  readonly attackerId: UnitId;
  readonly targetId: UnitId;
  readonly from: Point;
  readonly to: Point;
  readonly damage: number;
  readonly destroyed: boolean;
}

export interface WorldView {
  readonly matchId: MatchId;
  readonly tick: number;
  readonly playerIds: readonly PlayerId[];
  readonly units: readonly UnitView[];
  readonly combatEvents: readonly CombatEvent[];
}
