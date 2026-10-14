import { z } from "zod";
import type { WorldView } from "@warfront/shared";

export const protocolVersion = 1;
export const snapshotVersion = 2;

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

export const clientCommandSchema = z.discriminatedUnion("type", [
  moveUnitCommandSchema,
  attackUnitCommandSchema,
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

export const worldSnapshotSchema = z.object({
  snapshotVersion: z.literal(snapshotVersion),
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
export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type ServerMessage =
  | {
      readonly type: "SNAPSHOT";
      readonly state: WorldView & {
        readonly snapshotVersion: 2;
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
