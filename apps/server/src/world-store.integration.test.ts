import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { ManualClock, Simulation } from "@warfront/simulation";
import { MatchHost } from "./match-host.js";
import { WorldStore } from "./world-store.js";

const databaseUrl = process.env.DATABASE_URL_TEST;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgreSQL world recovery", () => {
  it("upgrades recovery-era snapshots with neutral sectors", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const store = new WorldStore(pool);
    const matchId = `sector-upgrade-${randomUUID()}`;
    try {
      await store.migrate();
      const snapshot = new Simulation(
        new ManualClock(0),
        undefined,
        matchId,
      ).snapshot();
      await pool.query(
        "INSERT INTO world_snapshots (match_id, snapshot) VALUES ($1, $2::jsonb)",
        [
          matchId,
          JSON.stringify({
            ...snapshot,
            snapshotVersion: 5,
            sectors: undefined,
          }),
        ],
      );
      const loaded = await store.load(matchId);
      expect(loaded?.snapshotVersion).toBe(6);
      expect(loaded?.sectors).toHaveLength(16);
      expect(loaded?.sectors.filter((sector) => sector.objective)).toHaveLength(
        4,
      );
    } finally {
      await pool.query("DELETE FROM world_snapshots WHERE match_id = $1", [
        matchId,
      ]);
      await pool.end();
    }
  });
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
      expect(loaded?.snapshotVersion).toBe(6);
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
      expect(loaded?.snapshotVersion).toBe(6);
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

  it("upgrades Milestone 5 saves and persists an offline army battle only once", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const store = new WorldStore(pool);
    const matchId = `army-${randomUUID()}`;
    try {
      await store.migrate();
      const clock = new ManualClock(1000);
      const seed = new Simulation(clock, undefined, matchId);
      seed.addPlayer("a");
      seed.addPlayer("b");
      const oldSnapshot = Object.fromEntries(
        Object.entries(seed.snapshot()).filter(
          ([key]) => key !== "armies" && key !== "battleReports",
        ),
      );
      await pool.query(
        "INSERT INTO world_snapshots (match_id, snapshot) VALUES ($1, $2::jsonb)",
        [matchId, JSON.stringify({ ...oldSnapshot, snapshotVersion: 3 })],
      );
      const upgraded = await store.load(matchId);
      expect(upgraded?.snapshotVersion).toBe(6);
      expect(upgraded?.armies).toEqual([]);
      const simulation = new Simulation(clock, upgraded);
      const armyId = randomUUID();
      simulation.command("a", {
        protocolVersion: 1,
        commandId: armyId,
        type: "CREATE_ARMY",
        name: "Offline Alpha",
        unitIds: ["artillery-a", "medium-a"],
      });
      simulation.command("a", {
        protocolVersion: 1,
        commandId: randomUUID(),
        type: "ORDER_ARMY",
        armyId,
        destination: { x: 10, z: 0 },
        stance: "attack",
        retreatThreshold: 30,
        postBattle: "hold",
      });
      const due = simulation.snapshot().armies[0]!.arrivesAtMs!;
      await store.save(simulation.snapshot());
      const host = await MatchHost.create(
        new ManualClock(due + 1000),
        store,
        matchId,
        () => undefined,
        () => undefined,
      );
      const reports = host.snapshot().battleReports;
      expect(
        reports.some(
          (report) => report.ownerId === "a" && report.kind !== "arrived",
        ),
      ).toBe(true);
      const restored = await MatchHost.create(
        new ManualClock(due + 5000),
        store,
        matchId,
        () => undefined,
        () => undefined,
      );
      expect(restored.snapshot().battleReports).toEqual(reports);
    } finally {
      await pool.query("DELETE FROM match_commands WHERE match_id = $1", [
        matchId,
      ]);
      await pool.query(
        "DELETE FROM match_scheduled_events WHERE match_id = $1",
        [matchId],
      );
      await pool.query("DELETE FROM world_snapshots WHERE match_id = $1", [
        matchId,
      ]);
      await pool.end();
    }
  });

  it("upgrades army-era snapshots with structure health and recovery state", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const store = new WorldStore(pool);
    const matchId = `upgrade-army-${randomUUID()}`;
    try {
      await store.migrate();
      const seed = new Simulation(new ManualClock(1000), undefined, matchId);
      seed.addPlayer("a");
      seed.command("a", {
        protocolVersion: 1,
        commandId: randomUUID(),
        type: "BUILD_STRUCTURE",
        kind: "extractor",
        nodeId: "node-a",
      });
      const snapshot = seed.snapshot();
      const old = {
        ...snapshot,
        snapshotVersion: 4,
        recovery: undefined,
        research: undefined,
        buildings: snapshot.buildings.map((building) => ({
          id: building.id,
          ownerId: building.ownerId,
          kind: building.kind,
          position: building.position,
          nodeId: building.nodeId,
          readyAtMs: building.readyAtMs,
        })),
      };
      await pool.query(
        "INSERT INTO world_snapshots (match_id, snapshot) VALUES ($1, $2::jsonb)",
        [matchId, JSON.stringify(old)],
      );
      const loaded = await store.load(matchId);
      expect(loaded?.snapshotVersion).toBe(6);
      expect(loaded?.buildings[0]?.health).toBe(120);
      expect(loaded?.recovery).toEqual([]);
      expect(loaded?.research).toEqual([{ playerId: "a", completed: [] }]);
    } finally {
      await pool.query(
        "DELETE FROM match_scheduled_events WHERE match_id = $1",
        [matchId],
      );
      await pool.query("DELETE FROM world_snapshots WHERE match_id = $1", [
        matchId,
      ]);
      await pool.end();
    }
  });

  it("restores respawn and protection timers after server downtime", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const store = new WorldStore(pool);
    const matchId = `recovery-${randomUUID()}`;
    try {
      await store.migrate();
      const clock = new ManualClock(1000);
      const seed = new Simulation(clock, undefined, matchId);
      seed.addPlayer("a");
      seed.addPlayer("b");
      const wiped = {
        ...seed.snapshot(),
        units: seed.snapshot().units.filter((unit) => unit.ownerId !== "b"),
        research: [
          { playerId: "a", completed: [] },
          { playerId: "b", completed: ["laser"] },
        ],
      };
      await store.save(new Simulation(clock, wiped).snapshot());
      const pendingEvents = await pool.query<{
        kind: string;
        applied_at_ms: number | null;
      }>(
        "SELECT kind, applied_at_ms FROM match_scheduled_events WHERE match_id = $1 AND kind = 'respawn'",
        [matchId],
      );
      expect(pendingEvents.rows).toEqual([
        { kind: "respawn", applied_at_ms: null },
      ]);
      const protectedHost = await MatchHost.create(
        new ManualClock(31_000),
        store,
        matchId,
        () => undefined,
        () => undefined,
      );
      expect(
        protectedHost.snapshot().recovery.find((item) => item.playerId === "b")
          ?.protectionEndsAtMs,
      ).toBe(91_000);
      expect(
        protectedHost.snapshot().research.find((item) => item.playerId === "b")
          ?.completed,
      ).toEqual(["laser"]);
      const expiredHost = await MatchHost.create(
        new ManualClock(100_000),
        store,
        matchId,
        () => undefined,
        () => undefined,
      );
      expect(
        expiredHost.snapshot().recovery.find((item) => item.playerId === "b")
          ?.protectionEndsAtMs,
      ).toBeNull();
      expect(
        expiredHost
          .snapshot()
          .battleReports.filter(
            (report) => report.ownerId === "b" && report.kind === "respawned",
          ),
      ).toHaveLength(1);
      const recoveryEvents = await pool.query<{
        kind: string;
        applied_at_ms: number | null;
      }>(
        "SELECT kind, applied_at_ms FROM match_scheduled_events WHERE match_id = $1 AND kind IN ('respawn', 'protection_end') ORDER BY kind",
        [matchId],
      );
      expect(recoveryEvents.rows.map((event) => event.kind)).toEqual([
        "protection_end",
        "respawn",
      ]);
      expect(
        recoveryEvents.rows.every((event) => event.applied_at_ms !== null),
      ).toBe(true);
      expect(
        expiredHost
          .snapshot()
          .battleReports.filter(
            (report) =>
              report.ownerId === "b" && report.kind === "protection_ended",
          ),
      ).toHaveLength(1);
    } finally {
      await pool.query(
        "DELETE FROM match_scheduled_events WHERE match_id = $1",
        [matchId],
      );
      await pool.query("DELETE FROM world_snapshots WHERE match_id = $1", [
        matchId,
      ]);
      await pool.end();
    }
  });

  it("journals commands and applies scheduled jobs once across restarts", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const store = new WorldStore(pool);
    const matchId = `durable-${randomUUID()}`;
    const errors: unknown[] = [];
    try {
      await store.migrate();
      const clock = new ManualClock(1000);
      const host = await MatchHost.create(
        clock,
        store,
        matchId,
        () => undefined,
        (error) => errors.push(error),
      );
      await host.addPlayer("builder");
      const extractor = {
        protocolVersion: 1 as const,
        commandId: randomUUID(),
        type: "BUILD_STRUCTURE" as const,
        kind: "extractor" as const,
        nodeId: "node-builder",
      };
      await host.command("builder", extractor);
      await host.command("builder", {
        protocolVersion: 1,
        commandId: randomUUID(),
        type: "BUILD_STRUCTURE",
        kind: "factory",
        nodeId: null,
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS total FROM match_commands WHERE match_id = $1",
            [matchId],
          )
        ).rows[0]?.total,
      ).toBe(2);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS total FROM match_scheduled_events WHERE match_id = $1",
            [matchId],
          )
        ).rows[0]?.total,
      ).toBe(2);
      clock.advanceBy(20_000);
      const resumed = await MatchHost.create(
        clock,
        store,
        matchId,
        () => undefined,
        (error) => errors.push(error),
      );
      expect(resumed.snapshot().resources[0]?.ore).toBe(20);
      const production = {
        protocolVersion: 1 as const,
        commandId: randomUUID(),
        type: "PRODUCE_UNIT" as const,
        factoryId: "factory-builder",
        role: "scout" as const,
      };
      await resumed.command("builder", production);
      clock.advanceBy(9_000);
      const recovered = await MatchHost.create(
        clock,
        store,
        matchId,
        () => undefined,
        (error) => errors.push(error),
      );
      expect(
        recovered
          .snapshot()
          .units.filter(
            (unit) => unit.id === `produced-${production.commandId}`,
          ),
      ).toHaveLength(1);
      const beforeRetry = recovered.snapshot();
      await recovered.command("builder", production);
      expect(recovered.snapshot()).toEqual(beforeRetry);
      await expect(
        recovered.command("builder", { ...production, role: "medium" }),
      ).rejects.toThrow("already used");
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS total FROM match_commands WHERE match_id = $1",
            [matchId],
          )
        ).rows[0]?.total,
      ).toBe(3);
      const events = await pool.query<{ applied_at_ms: number | null }>(
        "SELECT applied_at_ms FROM match_scheduled_events WHERE match_id = $1",
        [matchId],
      );
      expect(events.rows).toHaveLength(3);
      expect(events.rows.every((event) => event.applied_at_ms !== null)).toBe(
        true,
      );
      expect(errors).toEqual([]);
    } finally {
      await pool.query("DELETE FROM match_commands WHERE match_id = $1", [
        matchId,
      ]);
      await pool.query(
        "DELETE FROM match_scheduled_events WHERE match_id = $1",
        [matchId],
      );
      await pool.query("DELETE FROM world_snapshots WHERE match_id = $1", [
        matchId,
      ]);
      await pool.end();
    }
  });
});
