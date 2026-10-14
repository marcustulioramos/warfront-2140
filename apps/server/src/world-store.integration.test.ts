import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { ManualClock, Simulation } from "@warfront/simulation";
import { WorldStore } from "./world-store.js";

const databaseUrl = process.env.DATABASE_URL_TEST;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgreSQL world recovery", () => {
  it("restores a move without advancing through downtime", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const store = new WorldStore(pool);
    const matchId = `integration-${randomUUID()}`;
    try {
      await store.migrate();
      const clock = new ManualClock(0);
      const simulation = new Simulation(clock, {
        ...new Simulation(clock).snapshot(),
        matchId,
      });
      simulation.command("player-1", {
        protocolVersion: 1,
        commandId: randomUUID(),
        type: "MOVE_UNIT",
        unitId: "unit-1",
        destination: { x: 10, z: 0 },
      });
      clock.advanceBy(200);
      const before = simulation.advance();
      await store.save(before);
      const loaded = await store.load(matchId);
      expect(loaded?.units[0]?.destination?.x).toBe(10);

      const restartClock = new ManualClock(3_600_000);
      const restored = new Simulation(restartClock, loaded);
      expect(restored.snapshot().units[0]?.position.x).toBeCloseTo(1.2);
      restartClock.advanceBy(200);
      expect(restored.advance().units[0]?.position.x).toBeCloseTo(2.4);
    } finally {
      await pool.query("DELETE FROM world_snapshots WHERE match_id = $1", [
        matchId,
      ]);
      await pool.end();
    }
  });

  it("keeps combat deaths in PostgreSQL after restart without respawning the owner", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const store = new WorldStore(pool);
    const matchId = `combat-${randomUUID()}`;
    try {
      await store.migrate();
      const clock = new ManualClock();
      const seed = new Simulation(clock, undefined, matchId);
      seed.addPlayer("a");
      seed.addPlayer("b");
      const near = {
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
      const simulation = new Simulation(clock, near);
      simulation.command("a", {
        protocolVersion: 1,
        commandId: randomUUID(),
        type: "ATTACK_UNIT",
        unitId: "artillery-a",
        targetId: "unit-b",
      });
      clock.advanceBy(200);
      const destroyed = simulation.advance();
      expect(destroyed.units.some((unit) => unit.id === "unit-b")).toBe(false);
      await store.save(destroyed);

      const loaded = await store.load(matchId);
      const restored = new Simulation(new ManualClock(3_600_000), loaded);
      expect(
        restored.addPlayer("b").units.some((unit) => unit.id === "unit-b"),
      ).toBe(false);
      expect(restored.snapshot().playerIds).toEqual(["a", "b"]);
    } finally {
      await pool.query("DELETE FROM world_snapshots WHERE match_id = $1", [
        matchId,
      ]);
      await pool.end();
    }
  });

  it("upgrades a saved Milestone 2 scout to the three combat roles", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const store = new WorldStore(pool);
    const matchId = `legacy-${randomUUID()}`;
    try {
      await store.migrate();
      await pool.query(
        "INSERT INTO world_snapshots (match_id, snapshot) VALUES ($1, $2::jsonb)",
        [
          matchId,
          JSON.stringify({
            snapshotVersion: 1,
            matchId,
            tick: 7,
            lastSimulatedAtMs: 100,
            units: [
              {
                id: "unit-old",
                ownerId: "old",
                position: { x: 3, z: 0 },
                destination: null,
              },
            ],
          }),
        ],
      );
      const loaded = await store.load(matchId);
      expect(loaded?.snapshotVersion).toBe(3);
      expect(loaded?.playerIds).toEqual(["old"]);
      expect(loaded?.units.map((unit) => unit.role)).toEqual([
        "scout",
        "medium",
        "artillery",
      ]);
      if (loaded) await store.save(loaded);
      expect((await store.load(matchId))?.units).toHaveLength(3);
    } finally {
      await pool.query("DELETE FROM world_snapshots WHERE match_id = $1", [
        matchId,
      ]);
      await pool.end();
    }
  });

  it("restores construction, ore income and unit production after downtime", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const store = new WorldStore(pool);
    const matchId = `economy-${randomUUID()}`;
    try {
      await store.migrate();
      const clock = new ManualClock(1000);
      const simulation = new Simulation(clock, undefined, matchId);
      simulation.addPlayer("builder");
      simulation.command("builder", {
        protocolVersion: 1,
        commandId: randomUUID(),
        type: "BUILD_STRUCTURE",
        kind: "extractor",
        nodeId: "node-builder",
      });
      simulation.command("builder", {
        protocolVersion: 1,
        commandId: randomUUID(),
        type: "BUILD_STRUCTURE",
        kind: "factory",
        nodeId: null,
      });
      await store.save(simulation.snapshot());
      const resumed = new Simulation(
        new ManualClock(21_000),
        await store.load(matchId),
      );
      expect(resumed.snapshot().resources[0]?.ore).toBe(20);
      const jobId = randomUUID();
      resumed.command("builder", {
        protocolVersion: 1,
        commandId: jobId,
        type: "PRODUCE_UNIT",
        factoryId: "factory-builder",
        role: "scout",
      });
      await store.save(resumed.snapshot());
      const completed = new Simulation(
        new ManualClock(30_000),
        await store.load(matchId),
      );
      expect(completed.snapshot().production).toHaveLength(0);
      expect(
        completed
          .snapshot()
          .units.some((unit) => unit.id === `produced-${jobId}`),
      ).toBe(true);
      await store.save(completed.snapshot());
      expect(
        (await store.load(matchId))?.units.some(
          (unit) => unit.id === `produced-${jobId}`,
        ),
      ).toBe(true);
    } finally {
      await pool.query("DELETE FROM world_snapshots WHERE match_id = $1", [
        matchId,
      ]);
      await pool.end();
    }
  });

  it("adds economy state to an existing combat snapshot", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const store = new WorldStore(pool);
    const matchId = `upgrade-${randomUUID()}`;
    try {
      await store.migrate();
      const seed = new Simulation(new ManualClock(1000), undefined, matchId);
      seed.addPlayer("veteran");
      await pool.query(
        "INSERT INTO world_snapshots (match_id, snapshot) VALUES ($1, $2::jsonb)",
        [
          matchId,
          JSON.stringify({
            ...seed.snapshot(),
            snapshotVersion: 2,
            resourceNodes: undefined,
            buildings: undefined,
            production: undefined,
            resources: undefined,
          }),
        ],
      );
      const loaded = await store.load(matchId);
      expect(loaded?.snapshotVersion).toBe(3);
      expect(loaded?.resources).toEqual([{ playerId: "veteran", ore: 100 }]);
      expect(loaded?.resourceNodes[0]?.id).toBe("node-veteran");
      expect(loaded?.units).toHaveLength(3);
    } finally {
      await pool.query("DELETE FROM world_snapshots WHERE match_id = $1", [
        matchId,
      ]);
      await pool.end();
    }
  });
});
