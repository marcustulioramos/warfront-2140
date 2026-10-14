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
      expect(loaded?.snapshotVersion).toBe(2);
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
});
