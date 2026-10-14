import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { LobbyStore } from "./lobby-store.js";
import { WorldStore } from "./world-store.js";
import { ManualClock, Simulation } from "@warfront/simulation";

const databaseUrl = process.env.DATABASE_URL_TEST;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgreSQL multiplayer lobby", () => {
  it("authenticates accounts and keeps matches limited to two distinct players", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const lobby = new LobbyStore(pool);
    const playerIds: string[] = [];
    let matchId: string | undefined;
    try {
      await new WorldStore(pool).migrate();
      const suffix = randomUUID().slice(0, 12);
      const alice = await lobby.register(`a${suffix}`, "a-long-test-password");
      const bob = await lobby.register(`b${suffix}`, "a-long-test-password");
      const carol = await lobby.register(`c${suffix}`, "a-long-test-password");
      playerIds.push(alice.id, bob.id, carol.id);
      expect(
        await lobby.login(alice.username, "wrong-password"),
      ).toBeUndefined();
      expect(await lobby.login(alice.username, "a-long-test-password")).toEqual(
        alice,
      );
      const token = await lobby.createSession(alice.id);
      expect(await lobby.playerForToken(token)).toEqual(alice);
      await lobby.logout(token);
      expect(await lobby.playerForToken(token)).toBeUndefined();

      const match = await lobby.createMatch(
        "Test battle",
        alice,
        "Imperial Vanguard",
      );
      matchId = match.id;
      const joined = await lobby.joinMatch(match.id, bob, "Imperial Vanguard");
      expect(joined.players.map((player) => player.colour)).toEqual([
        "blue",
        "orange",
      ]);
      expect(joined.players.map((player) => player.faction)).toEqual([
        "Imperial Vanguard",
        "Imperial Vanguard",
      ]);
      expect(
        (await lobby.joinMatch(match.id, bob, "Iron Battalion")).players,
      ).toHaveLength(2);
      await expect(
        lobby.joinMatch(match.id, carol, "Iron Battalion"),
      ).rejects.toThrow("full");
    } finally {
      if (matchId)
        await pool.query("DELETE FROM matches WHERE id = $1", [matchId]);
      if (playerIds.length)
        await pool.query("DELETE FROM players WHERE id = ANY($1::uuid[])", [
          playerIds,
        ]);
      await pool.end();
    }
  });

  it("lets only the creator delete a match and its saved state", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL_TEST is required");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const lobby = new LobbyStore(pool);
    const store = new WorldStore(pool);
    const ids: string[] = [];
    let matchId: string | undefined;
    try {
      await store.migrate();
      const suffix = randomUUID().slice(0, 12);
      const alice = await lobby.register(`a${suffix}`, "a-long-test-password");
      const bob = await lobby.register(`b${suffix}`, "a-long-test-password");
      ids.push(alice.id, bob.id);
      const match = await lobby.createMatch(
        "Deletion test",
        alice,
        "Imperial Vanguard",
      );
      matchId = match.id;
      await lobby.joinMatch(match.id, bob, "Iron Battalion");
      expect((await lobby.getMatch(match.id))?.creatorId).toBe(alice.id);
      const clock = new ManualClock(1000);
      const simulation = new Simulation(clock, undefined, match.id);
      simulation.addPlayer(alice.id);
      simulation.addPlayer(bob.id);
      const command = {
        protocolVersion: 1 as const,
        commandId: randomUUID(),
        type: "BUILD_STRUCTURE" as const,
        kind: "extractor" as const,
        nodeId: `node-${alice.id}`,
      };
      simulation.command(alice.id, command);
      expect(
        await store.applyCommand(simulation.snapshot(), alice.id, command),
      ).toBe(true);
      await expect(lobby.deleteMatch(match.id, bob.id)).rejects.toThrow(
        "creator",
      );
      expect(await lobby.getMatch(match.id)).toBeDefined();
      await lobby.deleteMatch(match.id, alice.id);
      expect(await lobby.getMatch(match.id)).toBeUndefined();
      for (const table of [
        "world_snapshots",
        "match_commands",
        "match_scheduled_events",
      ]) {
        const result = await pool.query(
          `SELECT count(*)::int AS total FROM ${table} WHERE match_id = $1`,
          [match.id],
        );
        expect(result.rows[0]?.total).toBe(0);
      }
    } finally {
      if (matchId) {
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
        await pool.query("DELETE FROM matches WHERE id = $1", [matchId]);
      }
      if (ids.length)
        await pool.query("DELETE FROM players WHERE id = ANY($1::uuid[])", [
          ids,
        ]);
      await pool.end();
    }
  });
});
