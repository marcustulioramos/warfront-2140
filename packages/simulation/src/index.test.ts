import { describe, expect, it } from "vitest";
import { ManualClock, Simulation } from "./index.js";

describe("authoritative simulation", () => {
  it("moves a unit using the injected clock and rejects foreign commands", () => {
    const clock = new ManualClock();
    const simulation = new Simulation(clock);
    const command = {
      protocolVersion: 1 as const,
      commandId: "2ea7a97d-60d1-44e8-9742-a146261a69c0",
      type: "MOVE_UNIT" as const,
      unitId: "unit-1",
      destination: { x: 10, z: 0 },
    };
    expect(() => simulation.command("player-2", command)).toThrow();
    simulation.command("player-1", command);
    clock.advanceBy(1000);
    expect(simulation.advance().units[0]?.position.x).toBe(5);
  });
});
