import { describe, expect, it } from "vitest";
import { ManualClock, Simulation } from "./index.js";

const move = {
  protocolVersion: 1 as const,
  commandId: "2ea7a97d-60d1-44e8-9742-a146261a69c0",
  type: "MOVE_UNIT" as const,
  unitId: "unit-1",
  destination: { x: 10, z: 0 },
};

describe("authoritative simulation", () => {
  it("moves a unit using the injected clock and rejects foreign commands", () => {
    const clock = new ManualClock();
    const simulation = new Simulation(clock);
    expect(() => simulation.command("player-2", move)).toThrow("not owned");
    expect(() =>
      simulation.command("player-1", { ...move, destination: { x: 21, z: 0 } }),
    ).toThrow("outside map");
    simulation.command("player-1", move);
    clock.advanceBy(1000);
    expect(simulation.advance().units[0]?.position.x).toBe(5);
    clock.advanceBy(1000);
    expect(simulation.advance().units[0]?.position.x).toBe(10);
    expect(simulation.snapshot().units[0]?.destination).toBeNull();
  });

  it("pauses movement while the server is down", () => {
    const oldClock = new ManualClock(1000);
    const simulation = new Simulation(oldClock);
    simulation.command("player-1", move);
    oldClock.advanceBy(200);
    const saved = simulation.advance();
    const restartClock = new ManualClock(3_600_000);
    const restored = new Simulation(restartClock, saved);
    expect(restored.snapshot().units[0]?.position.x).toBe(1);
    restartClock.advanceBy(200);
    expect(restored.advance().units[0]?.position.x).toBe(2);
  });
});
