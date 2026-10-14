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

  it("charges for buildings and production, then completes jobs while disconnected", () => {
    const clock = new ManualClock(1000);
    const simulation = new Simulation(clock, undefined, "economy");
    simulation.addPlayer("a");
    simulation.addPlayer("b");
    const id = move.commandId;
    expect(() =>
      simulation.command("b", {
        protocolVersion: 1,
        commandId: id,
        type: "BUILD_STRUCTURE",
        kind: "extractor",
        nodeId: "node-a",
      }),
    ).toThrow("Invalid resource node");
    simulation.command("a", {
      protocolVersion: 1,
      commandId: id,
      type: "BUILD_STRUCTURE",
      kind: "extractor",
      nodeId: "node-a",
    });
    simulation.command("a", {
      protocolVersion: 1,
      commandId: id,
      type: "BUILD_STRUCTURE",
      kind: "factory",
      nodeId: null,
    });
    expect(
      simulation.snapshot().resources.find((item) => item.playerId === "a")
        ?.ore,
    ).toBe(0);
    expect(() =>
      simulation.command("a", {
        protocolVersion: 1,
        commandId: id,
        type: "PRODUCE_UNIT",
        factoryId: "factory-a",
        role: "scout",
      }),
    ).toThrow("not ready");
    const restored = new Simulation(
      new ManualClock(21_000),
      simulation.snapshot(),
    );
    expect(
      restored.snapshot().resources.find((item) => item.playerId === "a")?.ore,
    ).toBe(20);
    restored.command("a", {
      protocolVersion: 1,
      commandId: id,
      type: "PRODUCE_UNIT",
      factoryId: "factory-a",
      role: "scout",
    });
    expect(
      restored.snapshot().resources.find((item) => item.playerId === "a")?.ore,
    ).toBe(0);
    expect(() =>
      restored.command("a", {
        protocolVersion: 1,
        commandId: id,
        type: "PRODUCE_UNIT",
        factoryId: "factory-a",
        role: "scout",
      }),
    ).toThrow("already used");
    expect(() =>
      restored.command("a", {
        protocolVersion: 1,
        commandId: "7fa14880-c8c1-4cd6-8672-189276f0db33",
        type: "PRODUCE_UNIT",
        factoryId: "factory-a",
        role: "scout",
      }),
    ).toThrow("busy");
    const finished = new Simulation(
      new ManualClock(30_000),
      restored.snapshot(),
    );
    expect(finished.snapshot().production).toHaveLength(0);
    expect(
      finished.snapshot().units.some((unit) => unit.id === `produced-${id}`),
    ).toBe(true);
    expect(
      new Simulation(new ManualClock(40_000), finished.snapshot())
        .snapshot()
        .units.filter((unit) => unit.id === `produced-${id}`),
    ).toHaveLength(1);
  });

  it("resolves a named army attack while both players are offline and reports it once", () => {
    const clock = new ManualClock(1000);
    const simulation = new Simulation(clock, undefined, "offline-battle");
    simulation.addPlayer("a");
    simulation.addPlayer("b");
    const armyId = "aa982f47-5bc7-4bd4-8346-8da32422d13b";
    simulation.command("a", {
      protocolVersion: 1,
      commandId: armyId,
      type: "CREATE_ARMY",
      name: "Alpha",
      unitIds: ["unit-a", "medium-a", "artillery-a"],
    });
    expect(() =>
      simulation.command("b", {
        protocolVersion: 1,
        commandId: move.commandId,
        type: "ORDER_ARMY",
        armyId,
        destination: { x: 10, z: 0 },
        stance: "attack",
        retreatThreshold: 0,
        postBattle: "hold",
      }),
    ).toThrow("not owned");
    simulation.command("a", {
      protocolVersion: 1,
      commandId: move.commandId,
      type: "ORDER_ARMY",
      armyId,
      destination: { x: 10, z: 0 },
      stance: "attack",
      retreatThreshold: 0,
      postBattle: "hold",
    });
    expect(() =>
      simulation.command("a", { ...move, unitId: "unit-a" }),
    ).toThrow("travelling");
    const due = simulation.snapshot().armies[0]!.arrivesAtMs!;
    const restored = new Simulation(
      new ManualClock(due + 1000),
      simulation.snapshot(),
    );
    const result = restored.snapshot();
    expect(
      result.battleReports.filter((report) => report.ownerId === "a"),
    ).toHaveLength(1);
    expect(
      result.battleReports.filter((report) => report.ownerId === "b"),
    ).toHaveLength(1);
    expect(result.battleReports[0]?.enemyLosses).toBeGreaterThan(0);
    expect(result.armies.every((army) => army.arrivesAtMs === null)).toBe(true);
    expect(
      new Simulation(new ManualClock(due + 5000), result).snapshot()
        .battleReports,
    ).toHaveLength(2);
  });

  it("retreats surviving armies and completes their return after a long disconnect", () => {
    const clock = new ManualClock(0);
    const simulation = new Simulation(clock, undefined, "retreat");
    simulation.addPlayer("a");
    simulation.addPlayer("b");
    const armyId = "aa982f47-5bc7-4bd4-8346-8da32422d13b";
    simulation.command("a", {
      protocolVersion: 1,
      commandId: armyId,
      type: "CREATE_ARMY",
      name: "Retreat force",
      unitIds: ["medium-a"],
    });
    simulation.command("a", {
      protocolVersion: 1,
      commandId: move.commandId,
      type: "ORDER_ARMY",
      armyId,
      destination: { x: 10, z: 0 },
      stance: "attack",
      retreatThreshold: 90,
      postBattle: "hold",
    });
    const result = new Simulation(
      new ManualClock(200_000),
      simulation.snapshot(),
    ).snapshot();
    expect(
      result.battleReports.some(
        (report) => report.ownerId === "a" && report.kind === "retreated",
      ),
    ).toBe(true);
    expect(result.armies[0]?.arrivesAtMs).toBeNull();
    expect(
      result.units.find((unit) => unit.id === "medium-a")?.position.x,
    ).toBe(-10);
  });

  it("applies a defending army's retreat threshold during an offline attack", () => {
    const clock = new ManualClock();
    const simulation = new Simulation(clock, undefined, "defender-retreat");
    simulation.addPlayer("a");
    simulation.addPlayer("b");
    const attackId = "aa982f47-5bc7-4bd4-8346-8da32422d13b";
    const defendId = "ee982f47-5bc7-4bd4-8346-8da32422d13b";
    simulation.command("a", {
      protocolVersion: 1,
      commandId: attackId,
      type: "CREATE_ARMY",
      name: "Attack force",
      unitIds: ["medium-a", "artillery-a"],
    });
    simulation.command("b", {
      protocolVersion: 1,
      commandId: defendId,
      type: "CREATE_ARMY",
      name: "Guard force",
      unitIds: ["medium-b"],
    });
    simulation.command("b", {
      protocolVersion: 1,
      commandId: move.commandId,
      type: "ORDER_ARMY",
      armyId: defendId,
      destination: { x: 10, z: 0 },
      stance: "defend",
      retreatThreshold: 90,
      postBattle: "hold",
    });
    simulation.command("a", {
      protocolVersion: 1,
      commandId: "b6882103-332e-481d-8d67-d655010a9187",
      type: "ORDER_ARMY",
      armyId: attackId,
      destination: { x: 10, z: 0 },
      stance: "attack",
      retreatThreshold: 0,
      postBattle: "hold",
    });
    const result = new Simulation(
      new ManualClock(200_000),
      simulation.snapshot(),
    ).snapshot();
    expect(
      result.battleReports.some(
        (report) => report.ownerId === "b" && report.kind === "retreated",
      ),
    ).toBe(true);
    expect(
      result.armies.find((army) => army.id === defendId)?.arrivesAtMs,
    ).toBeNull();
    expect(
      result.units.find((unit) => unit.id === "medium-b")?.position.z,
    ).toBe(-4);
  });
});
