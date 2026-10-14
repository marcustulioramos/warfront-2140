import { readFile } from "node:fs/promises";
import pg from "pg";
import type { ClientCommand } from "@warfront/protocol";
import {
  legacyWorldSnapshotSchema,
  combatWorldSnapshotSchema,
  economyWorldSnapshotSchema,
  armyWorldSnapshotSchema,
  snapshotVersion,
  worldSnapshotSchema,
} from "@warfront/protocol";
import {
  RECOVERY,
  UNIT_STATS,
  WORLD_HALF_SIZE,
  type UnitView,
} from "@warfront/shared";
import { startingEconomy, type WorldSnapshot } from "@warfront/simulation";

const migrations = [
  "0001_world_snapshots",
  "0002_multiplayer",
  "0003_durable_events",
  "0004_match_ownership",
  "0005_recovery_events",
];

function upgradeArmySnapshot(
  snapshot: ReturnType<typeof armyWorldSnapshotSchema.parse>,
): WorldSnapshot {
  return {
    ...snapshot,
    snapshotVersion,
    buildings: snapshot.buildings.map((building) => ({
      ...building,
      health: RECOVERY.buildingHealth[building.kind],
      maxHealth: RECOVERY.buildingHealth[building.kind],
    })),
    recovery: [],
    research: snapshot.playerIds.map((playerId) => ({
      playerId,
      completed: [],
    })),
  };
}

export class WorldStore {
  constructor(private readonly pool: pg.Pool) {}

  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(2140, 1)");
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)",
      );
      for (const version of migrations) {
        const existing = await client.query<{ version: string }>(
          "SELECT version FROM schema_migrations WHERE version = $1",
          [version],
        );
        if (existing.rowCount === 0) {
          await client.query(
            await readFile(
              new URL(
                `../../../infrastructure/sql/${version}.sql`,
                import.meta.url,
              ),
              "utf8",
            ),
          );
          await client.query(
            "INSERT INTO schema_migrations (version) VALUES ($1)",
            [version],
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async load(matchId: string): Promise<WorldSnapshot | undefined> {
    const result = await this.pool.query<{ snapshot: unknown }>(
      "SELECT snapshot FROM world_snapshots WHERE match_id = $1",
      [matchId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const current = worldSnapshotSchema.safeParse(row.snapshot);
    if (current.success) return current.data;
    const army = armyWorldSnapshotSchema.safeParse(row.snapshot);
    if (army.success) return upgradeArmySnapshot(army.data);
    const economy = economyWorldSnapshotSchema.safeParse(row.snapshot);
    if (economy.success)
      return upgradeArmySnapshot(
        armyWorldSnapshotSchema.parse({
          ...economy.data,
          snapshotVersion: 4,
          armies: [],
          battleReports: [],
        }),
      );
    const combat = combatWorldSnapshotSchema.safeParse(row.snapshot);
    if (combat.success)
      return upgradeArmySnapshot(
        armyWorldSnapshotSchema.parse({
          ...combat.data,
          snapshotVersion: 4,
          ...startingEconomy(combat.data.playerIds),
          armies: [],
          battleReports: [],
        }),
      );
    const legacy = legacyWorldSnapshotSchema.parse(row.snapshot);
    const playerIds = [...new Set(legacy.units.map((unit) => unit.ownerId))];
    const units: UnitView[] = legacy.units.flatMap((unit) => {
      const scout: UnitView = {
        ...unit,
        role: "scout",
        targetId: null,
        health: UNIT_STATS.scout.maxHealth,
        maxHealth: UNIT_STATS.scout.maxHealth,
        cooldownMs: 0,
      };
      const extra = (["medium", "artillery"] as const).map(
        (role, index): UnitView => ({
          ...scout,
          id: `${role}-${unit.ownerId}`,
          role,
          position: {
            x: unit.position.x,
            z: Math.max(
              -WORLD_HALF_SIZE,
              Math.min(
                WORLD_HALF_SIZE,
                unit.position.z + (index === 0 ? -4 : 4),
              ),
            ),
          },
          destination: null,
          health: UNIT_STATS[role].maxHealth,
          maxHealth: UNIT_STATS[role].maxHealth,
        }),
      );
      return [scout, ...extra];
    });
    return upgradeArmySnapshot(
      armyWorldSnapshotSchema.parse({
        ...legacy,
        snapshotVersion: 4,
        playerIds,
        units,
        combatEvents: [],
        ...startingEconomy(playerIds),
        armies: [],
        battleReports: [],
      }),
    );
  }

  async save(snapshot: WorldSnapshot): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.writeSnapshot(client, snapshot);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async isDuplicate(
    matchId: string,
    playerId: string,
    command: ClientCommand,
  ): Promise<boolean> {
    const result = await this.pool.query<{ player_id: string; same: boolean }>(
      `SELECT player_id, command = $3::jsonb AS same FROM match_commands
       WHERE match_id = $1 AND command_id = $2`,
      [matchId, command.commandId, JSON.stringify(command)],
    );
    const recorded = result.rows[0];
    if (!recorded) return false;
    if (recorded.player_id !== playerId || !recorded.same)
      throw new Error("Command ID already used for a different order");
    return true;
  }

  async applyCommand(
    snapshot: WorldSnapshot,
    playerId: string,
    command: ClientCommand,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO match_commands (match_id, command_id, player_id, command)
         VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`,
        [
          snapshot.matchId,
          command.commandId,
          playerId,
          JSON.stringify(command),
        ],
      );
      if (inserted.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      await this.writeSnapshot(client, snapshot);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async writeSnapshot(
    client: pg.PoolClient,
    snapshot: WorldSnapshot,
  ): Promise<void> {
    await client.query(
      `INSERT INTO world_snapshots (match_id, snapshot)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (match_id)
       DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
      [snapshot.matchId, JSON.stringify(snapshot)],
    );
    for (const building of snapshot.buildings) {
      await client.query(
        `INSERT INTO match_scheduled_events (match_id, event_id, kind, due_at_ms)
         VALUES ($1, $2, 'building_ready', $3) ON CONFLICT DO NOTHING`,
        [snapshot.matchId, `building-${building.id}`, building.readyAtMs],
      );
    }
    for (const job of snapshot.production) {
      await client.query(
        `INSERT INTO match_scheduled_events (match_id, event_id, kind, due_at_ms)
         VALUES ($1, $2, 'unit_ready', $3) ON CONFLICT DO NOTHING`,
        [snapshot.matchId, `unit-${job.id}`, job.readyAtMs],
      );
    }
    for (const recovery of snapshot.recovery) {
      const respawnId = `respawn-${recovery.playerId}-${recovery.generation}`;
      const protectionId = `protection-${recovery.playerId}-${recovery.generation}`;
      if (recovery.respawnAtMs !== null) {
        await client.query(
          `INSERT INTO match_scheduled_events (match_id, event_id, kind, due_at_ms)
           VALUES ($1, $2, 'respawn', $3) ON CONFLICT DO NOTHING`,
          [snapshot.matchId, respawnId, recovery.respawnAtMs],
        );
      } else {
        await client.query(
          `UPDATE match_scheduled_events SET applied_at_ms = $3
           WHERE match_id = $1 AND event_id = $2 AND applied_at_ms IS NULL`,
          [snapshot.matchId, respawnId, snapshot.lastSimulatedAtMs],
        );
      }
      if (recovery.protectionEndsAtMs !== null) {
        await client.query(
          `INSERT INTO match_scheduled_events (match_id, event_id, kind, due_at_ms)
           VALUES ($1, $2, 'protection_end', $3) ON CONFLICT DO NOTHING`,
          [snapshot.matchId, protectionId, recovery.protectionEndsAtMs],
        );
      } else {
        await client.query(
          `UPDATE match_scheduled_events SET applied_at_ms = $3
           WHERE match_id = $1 AND event_id = $2 AND applied_at_ms IS NULL`,
          [snapshot.matchId, protectionId, snapshot.lastSimulatedAtMs],
        );
      }
    }
    await client.query(
      `UPDATE match_scheduled_events SET applied_at_ms = $2
       WHERE match_id = $1 AND applied_at_ms IS NULL AND due_at_ms <= $2`,
      [snapshot.matchId, snapshot.lastSimulatedAtMs],
    );
  }
}
