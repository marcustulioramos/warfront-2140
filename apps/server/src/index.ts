import Fastify from "fastify";
import websocket from "@fastify/websocket";
import pg from "pg";
import { clientCommandSchema, type ServerMessage } from "@warfront/protocol";
import { RealClock } from "@warfront/simulation";
import { LobbyStore, type Player } from "./lobby-store.js";
import { MatchHost } from "./match-host.js";
import { WorldStore } from "./world-store.js";
import { visibleSnapshot } from "./visibility.js";
import type { WorldSnapshot } from "@warfront/simulation";

const app = Fastify({ logger: true, bodyLimit: 16_384 });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const worldStore = new WorldStore(pool);
await worldStore.migrate();
const lobby = new LobbyStore(pool);
const hosts = new Map<string, Promise<MatchHost>>();
const deletingMatches = new Set<string>();
type Socket = {
  send(data: string): void;
  readonly readyState: number;
  close(code?: number): void;
  on(event: "message" | "close", listener: (...args: unknown[]) => void): void;
};
const clients = new Map<string, Map<Socket, string>>();

function send(socket: Socket, message: ServerMessage): void {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}
function broadcast(matchId: string, state: WorldSnapshot): void {
  for (const [socket, playerId] of clients.get(matchId) ?? [])
    send(socket, { type: "SNAPSHOT", state: visibleSnapshot(state, playerId) });
}
function hostFor(matchId: string): Promise<MatchHost> {
  if (deletingMatches.has(matchId))
    return Promise.reject(new Error("Match is being deleted"));
  let pending = hosts.get(matchId);
  if (!pending) {
    pending = MatchHost.create(
      new RealClock(),
      worldStore,
      matchId,
      (state) => broadcast(matchId, state),
      (error) => app.log.error(error),
    ).then((host) => {
      host.start();
      return host;
    });
    hosts.set(matchId, pending);
    void pending.catch(() => hosts.delete(matchId));
  }
  return pending;
}
function cookieToken(raw: string | undefined): string | undefined {
  return raw
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("warfront_session="))
    ?.slice("warfront_session=".length);
}
async function playerFor(
  cookie: string | undefined,
): Promise<Player | undefined> {
  return lobby.playerForToken(cookieToken(cookie));
}
function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Invalid request body");
  return body as Record<string, unknown>;
}
function credentials(body: unknown): { username: string; password: string } {
  const value = bodyObject(body);
  if (
    typeof value.username !== "string" ||
    !/^[a-zA-Z0-9_]{3,24}$/.test(value.username) ||
    typeof value.password !== "string" ||
    value.password.length < 10 ||
    value.password.length > 128
  )
    throw new Error(
      "Use a 3–24 character username and a password of at least 10 characters",
    );
  return { username: value.username, password: value.password };
}
function factionInput(body: unknown): string {
  const faction = bodyObject(body).faction;
  if (faction !== "Imperial Vanguard" && faction !== "Iron Battalion")
    throw new Error("Choose a faction");
  return faction;
}
function sessionCookie(token: string): string {
  return `warfront_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

app.addHook("preHandler", async (request, reply) => {
  if (!request.url.startsWith("/api/") || request.method === "GET") return;
  if (request.headers["x-warfront-request"] !== "1")
    return reply.code(403).send({ error: "Request header required" });
});
app.get("/health", async (_request, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ok", database: "ok" };
  } catch (error) {
    app.log.error(error);
    return reply
      .code(503)
      .send({ status: "unavailable", database: "unavailable" });
  }
});
app.post("/api/register", async (request, reply) => {
  try {
    const { username, password } = credentials(request.body);
    const player = await lobby.register(username, password);
    reply.header(
      "Set-Cookie",
      sessionCookie(await lobby.createSession(player.id)),
    );
    return player;
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "Registration failed",
    });
  }
});
app.post("/api/login", async (request, reply) => {
  try {
    const { username, password } = credentials(request.body);
    const player = await lobby.login(username, password);
    if (!player)
      return reply.code(401).send({ error: "Invalid username or password" });
    reply.header(
      "Set-Cookie",
      sessionCookie(await lobby.createSession(player.id)),
    );
    return player;
  } catch (error) {
    return reply
      .code(400)
      .send({ error: error instanceof Error ? error.message : "Login failed" });
  }
});
app.post("/api/logout", async (request, reply) => {
  await lobby.logout(cookieToken(request.headers.cookie));
  reply.header(
    "Set-Cookie",
    "warfront_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
  );
  return { ok: true };
});
app.get("/api/me", async (request, reply) => {
  const player = await playerFor(request.headers.cookie);
  return player ?? reply.code(401).send({ error: "Sign in required" });
});
app.get("/api/matches", async () => lobby.listMatches());
app.post("/api/matches", async (request, reply) => {
  const player = await playerFor(request.headers.cookie);
  if (!player) return reply.code(401).send({ error: "Sign in required" });
  try {
    const value = bodyObject(request.body);
    const name = typeof value.name === "string" ? value.name.trim() : "";
    if (name.length < 3 || name.length > 60)
      throw new Error("Match name must be 3–60 characters");
    const faction = factionInput(value);
    const match = await lobby.createMatch(name, player, faction);
    await (await hostFor(match.id)).addPlayer(player.id);
    return reply.code(201).send(match);
  } catch (error) {
    return reply.code(400).send({
      error: error instanceof Error ? error.message : "Could not create match",
    });
  }
});
app.post<{ Params: { id: string } }>(
  "/api/matches/:id/join",
  async (request, reply) => {
    const player = await playerFor(request.headers.cookie);
    if (!player) return reply.code(401).send({ error: "Sign in required" });
    try {
      const match = await lobby.joinMatch(
        request.params.id,
        player,
        factionInput(request.body),
      );
      await (await hostFor(match.id)).addPlayer(player.id);
      return match;
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Could not join match",
      });
    }
  },
);

app.delete<{ Params: { id: string } }>(
  "/api/matches/:id",
  async (request, reply) => {
    const player = await playerFor(request.headers.cookie);
    if (!player) return reply.code(401).send({ error: "Sign in required" });
    const id = request.params.id;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      return reply.code(400).send({ error: "Invalid match ID" });
    const match = await lobby.getMatch(id);
    if (!match) return reply.code(404).send({ error: "Match not found" });
    if (match.creatorId !== player.id)
      return reply
        .code(403)
        .send({ error: "Only the match creator can delete it" });
    if (deletingMatches.has(id))
      return reply.code(409).send({ error: "Match is already being deleted" });
    deletingMatches.add(id);
    try {
      const pending = hosts.get(id);
      if (pending) {
        await (await pending).close();
        hosts.delete(id);
      }
      await lobby.deleteMatch(id, player.id);
      for (const socket of clients.get(id)?.keys() ?? []) socket.close(1008);
      clients.delete(id);
      return { ok: true };
    } catch (error) {
      app.log.error(error);
      return reply.code(500).send({ error: "Could not delete match" });
    } finally {
      deletingMatches.delete(id);
    }
  },
);

await app.register(websocket);
app.get("/ws", { websocket: true }, (socket, request) => {
  const peer = socket as Socket;
  const token = cookieToken(request.headers.cookie);
  let player: Player | undefined;
  let matchId: string | undefined;
  let host: MatchHost | undefined;
  let ready = false;
  peer.on("message", (raw) => {
    void (async () => {
      if (!ready || !player || !host) {
        send(peer, {
          type: "ERROR",
          message: "Connection is initializing; retry the order",
        });
        return;
      }
      try {
        if (!(await lobby.playerForToken(token))) {
          peer.close(1008);
          return;
        }
        const command = clientCommandSchema.parse(
          JSON.parse(String(raw)) as unknown,
        );
        if (command.type === "ATTACK_UNIT") {
          const visible = visibleSnapshot(host.snapshot(), player.id);
          if (
            ![...visible.units, ...visible.buildings].some(
              (item) => item.id === command.targetId,
            )
          )
            throw new Error("Target is outside vision");
        }
        await host.command(player.id, command);
        send(peer, { type: "ACK", commandId: command.commandId });
      } catch (error) {
        send(peer, {
          type: "ERROR",
          message: error instanceof Error ? error.message : "Invalid command",
        });
      }
    })();
  });
  peer.on("close", () => {
    if (matchId) clients.get(matchId)?.delete(peer);
  });
  void (async () => {
    player = await lobby.playerForToken(token);
    const id = new URL(request.url, "http://localhost").searchParams.get(
      "matchId",
    );
    const match = id ? await lobby.getMatch(id) : undefined;
    if (!player || !match?.players.some((member) => member.id === player?.id)) {
      peer.close(1008);
      return;
    }
    matchId = match.id;
    host = await hostFor(match.id);
    const group = clients.get(match.id) ?? new Map<Socket, string>();
    group.set(peer, player.id);
    clients.set(match.id, group);
    ready = true;
    send(peer, { type: "WELCOME", playerId: player.id, matchId: match.id });
    send(peer, {
      type: "SNAPSHOT",
      state: visibleSnapshot(host.snapshot(), player.id),
    });
  })().catch((error) => {
    app.log.error(error);
    peer.close(1011);
  });
});

app.addHook("onClose", async () => {
  await Promise.all(
    [...hosts.values()].map(async (pending) => (await pending).close()),
  );
  await pool.end();
});
await app.listen({
  port: Number(process.env.SERVER_PORT ?? 3000),
  host: "0.0.0.0",
});
process.once("SIGTERM", () => {
  void app.close();
});
process.once("SIGINT", () => {
  void app.close();
});
