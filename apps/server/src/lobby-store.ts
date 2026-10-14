import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type pg from "pg";

const scrypt = promisify(scryptCallback);
const sessionAgeMs = 7 * 24 * 60 * 60 * 1000;

export interface Player {
  id: string;
  username: string;
}

export interface MatchPlayer extends Player {
  faction: string;
  colour: string;
}

export interface MatchSummary {
  id: string;
  name: string;
  players: MatchPlayer[];
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function passwordHash(
  password: string,
  salt = randomBytes(16).toString("hex"),
): Promise<string> {
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

async function passwordMatches(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const candidate = Buffer.from(
    (await passwordHash(password, salt)).split(":")[1] ?? "",
    "hex",
  );
  const expected = Buffer.from(hex, "hex");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

export class LobbyStore {
  constructor(private readonly pool: pg.Pool) {}

  async register(username: string, password: string): Promise<Player> {
    const id = randomUUID();
    const hash = await passwordHash(password);
    try {
      await this.pool.query(
        "INSERT INTO players (id, username, password_hash) VALUES ($1, $2, $3)",
        [id, username, hash],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new Error("Username already taken");
      throw error;
    }
    return { id, username };
  }

  async login(username: string, password: string): Promise<Player | undefined> {
    const result = await this.pool.query<Player & { password_hash: string }>(
      "SELECT id, username, password_hash FROM players WHERE username = $1",
      [username],
    );
    const row = result.rows[0];
    if (!row || !(await passwordMatches(password, row.password_hash)))
      return undefined;
    return { id: row.id, username: row.username };
  }

  async createSession(playerId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.pool.query(
      "INSERT INTO sessions (token_hash, player_id, expires_at) VALUES ($1, $2, $3)",
      [tokenHash(token), playerId, new Date(Date.now() + sessionAgeMs)],
    );
    return token;
  }

  async playerForToken(token: string | undefined): Promise<Player | undefined> {
    if (!token) return undefined;
    const result = await this.pool.query<Player>(
      `SELECT p.id, p.username FROM sessions s JOIN players p ON p.id = s.player_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [tokenHash(token)],
    );
    return result.rows[0];
  }

  async logout(token: string | undefined): Promise<void> {
    if (token)
      await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [
        tokenHash(token),
      ]);
  }

  async createMatch(
    name: string,
    creator: Player,
    faction: string,
  ): Promise<MatchSummary> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO matches (id, name) VALUES ($1, $2)", [
        id,
        name,
      ]);
      await client.query(
        "INSERT INTO match_players (match_id, player_id, faction, colour) VALUES ($1, $2, $3, $4)",
        [id, creator.id, faction, "blue"],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { id, name, players: [{ ...creator, faction, colour: "blue" }] };
  }

  async joinMatch(
    id: string,
    player: Player,
    faction: string,
  ): Promise<MatchSummary> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const match = await client.query<{ name: string }>(
        "SELECT name FROM matches WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!match.rows[0]) throw new Error("Match not found");
      const members = await client.query<{ player_id: string }>(
        "SELECT player_id FROM match_players WHERE match_id = $1",
        [id],
      );
      if (!members.rows.some((row) => row.player_id === player.id)) {
        if (members.rows.length >= 2) throw new Error("Match is full");
        await client.query(
          "INSERT INTO match_players (match_id, player_id, faction, colour) VALUES ($1, $2, $3, $4)",
          [id, player.id, faction, "orange"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const match = await this.getMatch(id);
    if (!match) throw new Error("Match not found");
    return match;
  }

  async getMatch(id: string): Promise<MatchSummary | undefined> {
    const result = await this.pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM matches WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const players = await this.pool.query<MatchPlayer>(
      `SELECT p.id, p.username, mp.faction, mp.colour
       FROM match_players mp JOIN players p ON p.id = mp.player_id
       WHERE mp.match_id = $1 ORDER BY mp.joined_at, p.id`,
      [id],
    );
    return { ...row, players: players.rows };
  }

  async listMatches(): Promise<MatchSummary[]> {
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM matches ORDER BY created_at DESC LIMIT 50",
    );
    return (
      await Promise.all(result.rows.map((row) => this.getMatch(row.id)))
    ).filter((match): match is MatchSummary => match !== undefined);
  }
}
