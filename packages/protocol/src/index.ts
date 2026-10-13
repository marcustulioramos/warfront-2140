import { z } from "zod";

export const protocolVersion = 1;
export const moveUnitCommandSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  commandId: z.uuid(),
  type: z.literal("MOVE_UNIT"),
  unitId: z.string().min(1).max(80),
  destination: z.object({ x: z.number().finite(), z: z.number().finite() }),
});

export type MoveUnitCommand = z.infer<typeof moveUnitCommandSchema>;
