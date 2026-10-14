import { readFile } from "node:fs/promises";
import pg from "pg";
import { worldSnapshotSchema } from "@warfront/protocol";
import type { WorldSnapshot } from "@warfront/simulation";

const migrations = ["0001_world_snapshots", "0002_multiplayer"];

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
    return row ? worldSnapshotSchema.parse(row.snapshot) : undefined;
  }

  async save(snapshot: WorldSnapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO world_snapshots (match_id, snapshot)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (match_id)
       DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
      [snapshot.matchId, JSON.stringify(snapshot)],
    );
  }
}
