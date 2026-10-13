import Fastify from "fastify";
import websocket from "@fastify/websocket";
import pg from "pg";
import { moveUnitCommandSchema } from "@warfront/protocol";
import { RealClock, Simulation } from "@warfront/simulation";

const app = Fastify({ logger: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const simulation = new Simulation(new RealClock());

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
app.get("/state", async () => simulation.snapshot());
app.get("/ws", { websocket: true }, (socket) => {
  socket.send(
    JSON.stringify({ type: "SNAPSHOT", state: simulation.snapshot() }),
  );
  socket.on("message", (message: unknown) => {
    try {
      const parsed: unknown = JSON.parse(String(message));
      const command = moveUnitCommandSchema.parse(parsed);
      simulation.command("player-1", command);
      socket.send(
        JSON.stringify({ type: "ACK", commandId: command.commandId }),
      );
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "ERROR",
          message: error instanceof Error ? error.message : "Invalid command",
        }),
      );
    }
  });
});
const interval = setInterval(() => simulation.advance(), 200);
app.addHook("onClose", async () => {
  clearInterval(interval);
  await pool.end();
});
await app.listen({
  port: Number(process.env.SERVER_PORT ?? 3000),
  host: "0.0.0.0",
});
