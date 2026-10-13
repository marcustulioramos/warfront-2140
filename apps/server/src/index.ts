import Fastify from "fastify";
import websocket from "@fastify/websocket";
import pg from "pg";
import { moveUnitCommandSchema, type ServerMessage } from "@warfront/protocol";
import { RealClock } from "@warfront/simulation";
import { MatchHost } from "./match-host.js";
import { WorldStore } from "./world-store.js";

const app = Fastify({ logger: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const clients = new Set<{
  send(data: string): void;
  readonly readyState: number;
}>();

function broadcast(message: ServerMessage): void {
  const encoded = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) client.send(encoded);
  }
}

const host = await MatchHost.create(
  new RealClock(),
  new WorldStore(pool),
  (state) => broadcast({ type: "SNAPSHOT", state }),
  (error) => app.log.error(error),
);

await app.register(websocket);

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

app.get("/state", async () => host.snapshot());

app.get("/ws", { websocket: true }, (socket) => {
  clients.add(socket);
  socket.send(
    JSON.stringify({
      type: "SNAPSHOT",
      state: host.snapshot(),
    } satisfies ServerMessage),
  );
  socket.on("close", () => {
    clients.delete(socket);
  });
  socket.on("message", (message: unknown) => {
    void (async () => {
      try {
        const parsed: unknown = JSON.parse(String(message));
        const command = moveUnitCommandSchema.parse(parsed);
        await host.command("player-1", command);
        socket.send(
          JSON.stringify({
            type: "ACK",
            commandId: command.commandId,
          } satisfies ServerMessage),
        );
        app.log.info(
          { commandId: command.commandId, type: command.type },
          "command accepted",
        );
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "ERROR",
            message: error instanceof Error ? error.message : "Invalid command",
          } satisfies ServerMessage),
        );
        app.log.warn({ error }, "command rejected");
      }
    })();
  });
});

host.start();
app.addHook("onClose", async () => {
  await host.close();
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
