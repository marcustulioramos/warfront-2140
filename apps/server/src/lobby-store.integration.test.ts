import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { LobbyStore } from "./lobby-store.js";
import { WorldStore } from "./world-store.js";

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
});
