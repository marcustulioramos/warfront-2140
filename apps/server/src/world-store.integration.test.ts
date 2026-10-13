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
      expect(restored.snapshot().units[0]?.position.x).toBe(1);
      restartClock.advanceBy(200);
      expect(restored.advance().units[0]?.position.x).toBe(2);
    } finally {
      await pool.query("DELETE FROM world_snapshots WHERE match_id = $1", [
        matchId,
      ]);
      await pool.end();
    }
  });
});
