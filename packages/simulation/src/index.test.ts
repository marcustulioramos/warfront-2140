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
    expect(simulation.advance().units[0]?.position.x).toBe(6);
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
    expect(restored.snapshot().units[0]?.position.x).toBeCloseTo(1.2);
    restartClock.advanceBy(200);
    expect(restored.advance().units[0]?.position.x).toBeCloseTo(2.4);
  });

  it("lets each player move only their own scout", () => {
    const simulation = new Simulation(new ManualClock(), undefined, "match-1");
    simulation.addPlayer("player-a");
    simulation.addPlayer("player-b");
    expect(simulation.snapshot().units.map((unit) => unit.position.x)).toEqual([
      -10, -10, -10, 10, 10, 10,
    ]);
    expect(() =>
      simulation.command("player-a", { ...move, unitId: "unit-player-b" }),
    ).toThrow("not owned");
    simulation.command("player-b", {
      ...move,
      unitId: "unit-player-b",
      destination: { x: 8, z: 0 },
    });
    expect(
      simulation.snapshot().units.find((unit) => unit.id === "unit-player-b")
        ?.destination,
    ).toEqual({ x: 8, z: 0 });
    expect(() => simulation.addPlayer("player-c")).toThrow("full");
  });

  it("resolves simultaneous server attacks and respects reload time", () => {
    const clock = new ManualClock();
    const seed = new Simulation(clock, undefined, "battle");
    seed.addPlayer("a");
    seed.addPlayer("b");
    const close = {
      ...seed.snapshot(),
      units: seed
        .snapshot()
        .units.map((unit) =>
          unit.id === "unit-a"
            ? { ...unit, position: { x: 0, z: 0 } }
            : unit.id === "unit-b"
              ? { ...unit, position: { x: 3, z: 0 } }
              : unit,
        ),
    };
    const simulation = new Simulation(clock, close);
    const attack = {
      protocolVersion: 1 as const,
      commandId: move.commandId,
      type: "ATTACK_UNIT" as const,
      unitId: "unit-a",
      targetId: "unit-b",
    };
    expect(() => simulation.command("b", attack)).toThrow("not owned");
    expect(() =>
      simulation.command("a", { ...attack, targetId: "medium-a" }),
    ).toThrow("Invalid enemy");
    simulation.command("a", attack);
    simulation.command("b", {
      ...attack,
      unitId: "unit-b",
      targetId: "unit-a",
    });
    clock.advanceBy(200);
    const first = simulation.advance();
    expect(first.combatEvents).toHaveLength(2);
    expect(first.units.find((unit) => unit.id === "unit-a")?.health).toBe(38);
    expect(first.units.find((unit) => unit.id === "unit-b")?.health).toBe(38);
    clock.advanceBy(200);
    expect(simulation.advance().combatEvents).toHaveLength(0);
    clock.advanceBy(600);
    expect(simulation.advance().combatEvents).toHaveLength(2);
  });

  it("allows both opposing units to destroy each other on one tick", () => {
    const clock = new ManualClock();
    const seed = new Simulation(clock, undefined, "battle");
    seed.addPlayer("a");
    seed.addPlayer("b");
    const close = {
      ...seed.snapshot(),
      units: seed
        .snapshot()
        .units.map((unit) =>
          unit.id === "unit-a"
            ? { ...unit, position: { x: 0, z: 0 }, health: 7 }
            : unit.id === "unit-b"
              ? { ...unit, position: { x: 3, z: 0 }, health: 7 }
              : unit,
        ),
    };
    const simulation = new Simulation(clock, close);
    simulation.command("a", {
      protocolVersion: 1,
      commandId: move.commandId,
      type: "ATTACK_UNIT",
      unitId: "unit-a",
      targetId: "unit-b",
    });
    simulation.command("b", {
      protocolVersion: 1,
      commandId: move.commandId,
      type: "ATTACK_UNIT",
      unitId: "unit-b",
      targetId: "unit-a",
    });
    clock.advanceBy(200);
    const result = simulation.advance();
    expect(
      result.units.some((unit) => unit.id === "unit-a" || unit.id === "unit-b"),
    ).toBe(false);
    expect(result.combatEvents).toHaveLength(2);
    expect(result.combatEvents.every((event) => event.destroyed)).toBe(true);
  });

  it("keeps destroyed units gone after reconnect and pauses reload during downtime", () => {
    const clock = new ManualClock();
    const seed = new Simulation(clock, undefined, "battle");
    seed.addPlayer("a");
    seed.addPlayer("b");
    const close = {
      ...seed.snapshot(),
      units: seed
        .snapshot()
        .units.map((unit) =>
          unit.id === "artillery-a"
            ? { ...unit, position: { x: 0, z: 0 } }
            : unit.id === "unit-b"
              ? { ...unit, position: { x: 5, z: 0 }, health: 20 }
              : unit,
        ),
    };
    const simulation = new Simulation(clock, close);
    simulation.command("a", {
      protocolVersion: 1,
      commandId: move.commandId,
      type: "ATTACK_UNIT",
      unitId: "artillery-a",
      targetId: "unit-b",
    });
    clock.advanceBy(200);
    const destroyed = simulation.advance();
    expect(destroyed.units.some((unit) => unit.id === "unit-b")).toBe(false);
    expect(
      destroyed.combatEvents.some(
        (event) => event.targetId === "unit-b" && event.destroyed,
      ),
    ).toBe(true);
    const restartClock = new ManualClock(3_600_000);
    const restored = new Simulation(restartClock, destroyed);
    expect(
      restored.addPlayer("b").units.some((unit) => unit.id === "unit-b"),
    ).toBe(false);
    expect(
      restored.snapshot().units.find((unit) => unit.id === "artillery-a")
        ?.cooldownMs,
    ).toBe(2500);
    restartClock.advanceBy(200);
    expect(
      restored.advance().units.find((unit) => unit.id === "artillery-a")
        ?.cooldownMs,
    ).toBe(2300);
  });
});
