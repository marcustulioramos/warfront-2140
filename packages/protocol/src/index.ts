import { z } from "zod";
import type { WorldView } from "@warfront/shared";

export const protocolVersion = 1;
export const snapshotVersion = 6;

const pointSchema = z.object({
  x: z.number().finite(),
  z: z.number().finite(),
});

export const moveUnitCommandSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  commandId: z.uuid(),
  type: z.literal("MOVE_UNIT"),
  unitId: z.string().min(1).max(80),
  destination: pointSchema,
});

export const attackUnitCommandSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  commandId: z.uuid(),
  type: z.literal("ATTACK_UNIT"),
  unitId: z.string().min(1).max(80),
  targetId: z.string().min(1).max(80),
});

export const buildStructureCommandSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  commandId: z.uuid(),
  type: z.literal("BUILD_STRUCTURE"),
  kind: z.enum(["extractor", "factory"]),
  nodeId: z.string().min(1).max(80).nullable(),
});
export const produceUnitCommandSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  commandId: z.uuid(),
  type: z.literal("PRODUCE_UNIT"),
  factoryId: z.string().min(1).max(80),
  role: z.enum(["scout", "medium", "artillery"]),
});
export const createArmyCommandSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  commandId: z.uuid(),
  type: z.literal("CREATE_ARMY"),
  name: z.string().trim().min(3).max(32),
  unitIds: z.array(z.string().min(1).max(80)).min(1).max(20),
});
export const orderArmyCommandSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  commandId: z.uuid(),
  type: z.literal("ORDER_ARMY"),
  armyId: z.string().min(1).max(80),
  destination: pointSchema,
  stance: z.enum(["attack", "defend"]),
  retreatThreshold: z.number().int().min(0).max(90),
  postBattle: z.enum(["hold", "return"]),
});
export const clientCommandSchema = z.discriminatedUnion("type", [
  moveUnitCommandSchema,
  attackUnitCommandSchema,
  buildStructureCommandSchema,
  produceUnitCommandSchema,
  createArmyCommandSchema,
  orderArmyCommandSchema,
]);

const legacyUnitSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  position: pointSchema,
  destination: pointSchema.nullable(),
});

export const legacyWorldSnapshotSchema = z.object({
  snapshotVersion: z.literal(1),
  matchId: z.string(),
  tick: z.number().int().nonnegative(),
  lastSimulatedAtMs: z.number().finite(),
  units: z.array(legacyUnitSchema),
});

export const combatWorldSnapshotSchema = z.object({
  snapshotVersion: z.literal(2),
  matchId: z.string(),
  tick: z.number().int().nonnegative(),
  lastSimulatedAtMs: z.number().finite(),
  playerIds: z.array(z.string()),
  units: z.array(
    legacyUnitSchema.extend({
      role: z.enum(["scout", "medium", "artillery"]),
      targetId: z.string().nullable(),
      health: z.number().int().nonnegative(),
      maxHealth: z.number().int().positive(),
      cooldownMs: z.number().finite().nonnegative(),
    }),
  ),
  combatEvents: z.array(
    z.object({
      attackerId: z.string(),
      targetId: z.string(),
      from: pointSchema,
      to: pointSchema,
      damage: z.number().int().nonnegative(),
      destroyed: z.boolean(),
    }),
  ),
});

export const economyWorldSnapshotSchema = combatWorldSnapshotSchema.extend({
  snapshotVersion: z.literal(3),
  resourceNodes: z.array(z.object({ id: z.string(), position: pointSchema })),
  buildings: z.array(
    z.object({
      id: z.string(),
      ownerId: z.string(),
      kind: z.enum(["extractor", "factory"]),
      position: pointSchema,
      nodeId: z.string().nullable(),
      readyAtMs: z.number().finite(),
    }),
  ),
  production: z.array(
    z.object({
      id: z.string(),
      ownerId: z.string(),
      role: z.enum(["scout", "medium", "artillery"]),
      factoryId: z.string(),
      readyAtMs: z.number().finite(),
    }),
  ),
  resources: z.array(
    z.object({ playerId: z.string(), ore: z.number().finite().nonnegative() }),
  ),
});
export const armyWorldSnapshotSchema = economyWorldSnapshotSchema.extend({
  snapshotVersion: z.literal(4),
  armies: z.array(
    z.object({
      id: z.string(),
      ownerId: z.string(),
      name: z.string(),
      unitIds: z.array(z.string()),
      origin: pointSchema,
      destination: pointSchema,
      stance: z.enum(["attack", "defend"]),
      retreatThreshold: z.number().int().min(0).max(90),
      postBattle: z.enum(["hold", "return"]),
      arrivesAtMs: z.number().finite().nullable(),
    }),
  ),
  battleReports: z.array(
    z.object({
      id: z.string(),
      atMs: z.number().finite(),
      armyId: z.string(),
      ownerId: z.string(),
      kind: z.enum(["arrived", "battle", "retreated", "destroyed"]),
      message: z.string(),
      ownLosses: z.number().int().nonnegative(),
      enemyLosses: z.number().int().nonnegative(),
    }),
  ),
});
export const recoveryWorldSnapshotSchema = armyWorldSnapshotSchema.extend({
  snapshotVersion: z.literal(5),
  buildings: z.array(
    z.object({
      id: z.string(),
      ownerId: z.string(),
      kind: z.enum(["extractor", "factory"]),
      position: pointSchema,
      nodeId: z.string().nullable(),
      readyAtMs: z.number().finite(),
      health: z.number().finite().nonnegative(),
      maxHealth: z.number().finite().positive(),
    }),
  ),
  battleReports: z.array(
    armyWorldSnapshotSchema.shape.battleReports.element.extend({
      kind: z.enum([
        "arrived",
        "battle",
        "retreated",
        "destroyed",
        "recovery_scheduled",
        "respawned",
        "protection_ended",
      ]),
    }),
  ),
  recovery: z.array(
    z.object({
      playerId: z.string(),
      generation: z.number().int().nonnegative(),
      site: pointSchema,
      respawnAtMs: z.number().finite().nullable(),
      protectionEndsAtMs: z.number().finite().nullable(),
    }),
  ),
  research: z.array(
    z.object({ playerId: z.string(), completed: z.array(z.string()) }),
  ),
});
export const worldSnapshotSchema = recoveryWorldSnapshotSchema.extend({
  snapshotVersion: z.literal(snapshotVersion),
  sectors: z.array(
    z.object({
      id: z.string(),
      column: z.number().int().min(0).max(3),
      row: z.number().int().min(0).max(3),
      ownerId: z.string().nullable(),
      objective: z.boolean(),
      visible: z.boolean().optional(),
    }),
  ),
});

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SNAPSHOT"), state: worldSnapshotSchema }),
  z.object({
    type: z.literal("WELCOME"),
    playerId: z.string(),
    matchId: z.string(),
  }),
  z.object({ type: z.literal("ACK"), commandId: z.uuid() }),
  z.object({ type: z.literal("ERROR"), message: z.string() }),
]);

export type MoveUnitCommand = z.infer<typeof moveUnitCommandSchema>;
export type AttackUnitCommand = z.infer<typeof attackUnitCommandSchema>;
export type BuildStructureCommand = z.infer<typeof buildStructureCommandSchema>;
export type ProduceUnitCommand = z.infer<typeof produceUnitCommandSchema>;
export type CreateArmyCommand = z.infer<typeof createArmyCommandSchema>;
export type OrderArmyCommand = z.infer<typeof orderArmyCommandSchema>;
export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type ServerMessage =
  | {
      readonly type: "SNAPSHOT";
      readonly state: WorldView & {
        readonly snapshotVersion: 6;
        readonly lastSimulatedAtMs: number;
      };
    }
  | { readonly type: "ACK"; readonly commandId: string }
  | {
      readonly type: "WELCOME";
      readonly playerId: string;
      readonly matchId: string;
    }
  | { readonly type: "ERROR"; readonly message: string };
