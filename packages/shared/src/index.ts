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
export type BuildingKind = "extractor" | "factory";
export const ECONOMY = {
  startingOre: 100,
  extractorCost: 40,
  factoryCost: 60,
  extractorBuildMs: 10_000,
  factoryBuildMs: 15_000,
  orePerSecond: 2,
  unitCost: { scout: 20, medium: 40, artillery: 60 },
  unitBuildMs: { scout: 8_000, medium: 12_000, artillery: 18_000 },
} as const;

export const RECOVERY = {
  respawnDelayMs: 30_000,
  protectionMs: 60_000,
  protectionRadius: 8,
  startingOre: 20,
  buildingHealth: { extractor: 120, factory: 160 },
} as const;

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

export type ArmyStance = "attack" | "defend";
export type PostBattleOrder = "hold" | "return";

export interface ArmyView {
  readonly id: string;
  readonly ownerId: PlayerId;
  readonly name: string;
  readonly unitIds: readonly UnitId[];
  readonly origin: Point;
  readonly destination: Point;
  readonly stance: ArmyStance;
  readonly retreatThreshold: number;
  readonly postBattle: PostBattleOrder;
  readonly arrivesAtMs: number | null;
}

export interface BattleReport {
  readonly id: string;
  readonly atMs: number;
  readonly armyId: string;
  readonly ownerId: PlayerId;
  readonly kind:
    | "arrived"
    | "battle"
    | "retreated"
    | "destroyed"
    | "recovery_scheduled"
    | "respawned"
    | "protection_ended";
  readonly message: string;
  readonly ownLosses: number;
  readonly enemyLosses: number;
}

export interface RecoveryView {
  readonly playerId: PlayerId;
  readonly generation: number;
  readonly site: Point;
  readonly respawnAtMs: number | null;
  readonly protectionEndsAtMs: number | null;
}

export interface WorldView {
  readonly matchId: MatchId;
  readonly tick: number;
  readonly playerIds: readonly PlayerId[];
  readonly units: readonly UnitView[];
  readonly combatEvents: readonly CombatEvent[];
  readonly armies: readonly ArmyView[];
  readonly battleReports: readonly BattleReport[];
  readonly recovery: readonly RecoveryView[];
  readonly research: readonly {
    playerId: PlayerId;
    completed: readonly string[];
  }[];
  readonly resourceNodes: readonly { id: string; position: Point }[];
  readonly buildings: readonly {
    id: string;
    ownerId: PlayerId;
    kind: BuildingKind;
    position: Point;
    nodeId: string | null;
    readyAtMs: number;
    health: number;
    maxHealth: number;
  }[];
  readonly production: readonly {
    id: string;
    ownerId: PlayerId;
    role: UnitRole;
    factoryId: string;
    readyAtMs: number;
  }[];
  readonly resources: readonly { playerId: PlayerId; ore: number }[];
}
