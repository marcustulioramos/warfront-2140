import { z } from "zod";
import type { WorldView } from "@warfront/shared";

export const protocolVersion = 1;
export const snapshotVersion = 3;

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
export const clientCommandSchema = z.discriminatedUnion("type", [
  moveUnitCommandSchema,
  attackUnitCommandSchema,
  buildStructureCommandSchema,
  produceUnitCommandSchema,
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

export const worldSnapshotSchema = combatWorldSnapshotSchema.extend({
  snapshotVersion: z.literal(snapshotVersion),
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
export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type ServerMessage =
  | {
      readonly type: "SNAPSHOT";
      readonly state: WorldView & {
        readonly snapshotVersion: 3;
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
