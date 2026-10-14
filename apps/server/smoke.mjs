/* global process, fetch, setTimeout, console */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import WebSocket from "ws";

const port = 3101;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["apps/server/dist/index.js"], {
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL_TEST,
    SERVER_PORT: String(port),
  },
  stdio: "ignore",
});

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Server exited before becoming healthy");
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* Wait for startup. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not become healthy");
}

async function request(path, method = "GET", body, cookie) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-warfront-request": "1",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

async function connect(matchId, cookie) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?matchId=${matchId}`, {
    headers: { cookie },
  });
  const received = [];
  socket.on("message", (data) => received.push(JSON.parse(String(data))));
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, received };
}

async function until(session, predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = session.received.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for WebSocket message: ${JSON.stringify(session.received)}`,
  );
}

try {
  assert.ok(process.env.DATABASE_URL_TEST, "DATABASE_URL_TEST is required");
  await waitForServer();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const alice = await request("/register", "POST", {
    username: `a${suffix}`,
    password: "long-test-password",
  });
  const bob = await request("/register", "POST", {
    username: `b${suffix}`,
    password: "long-test-password",
  });
  assert.equal(alice.status, 200);
  assert.equal(bob.status, 200);
  const match = await request(
    "/matches",
    "POST",
    { name: "Two player smoke test", faction: "Imperial Vanguard" },
    alice.cookie,
  );
  assert.equal(match.status, 201);
  const joined = await request(
    `/matches/${match.data.id}/join`,
    "POST",
    { faction: "Imperial Vanguard" },
    bob.cookie,
  );
  assert.equal(joined.status, 200);
  assert.deepEqual(
    joined.data.players.map((player) => player.colour),
    ["blue", "orange"],
  );

  const a = await connect(match.data.id, alice.cookie);
  let b = await connect(match.data.id, bob.cookie);
  await until(
    a,
    (message) =>
      message.type === "SNAPSHOT" && message.state.units.length === 2,
  );
  await until(
    b,
    (message) =>
      message.type === "SNAPSHOT" && message.state.units.length === 2,
  );

  const forbiddenId = randomUUID();
  a.socket.send(
    JSON.stringify({
      protocolVersion: 1,
      commandId: forbiddenId,
      type: "MOVE_UNIT",
      unitId: `unit-${bob.data.id}`,
      destination: { x: 5, z: 0 },
    }),
  );
  assert.match(
    (await until(a, (message) => message.type === "ERROR")).message,
    /not owned/,
  );

  const moveId = randomUUID();
  b.socket.send(
    JSON.stringify({
      protocolVersion: 1,
      commandId: moveId,
      type: "MOVE_UNIT",
      unitId: `unit-${bob.data.id}`,
      destination: { x: 5, z: 0 },
    }),
  );
  await until(
    b,
    (message) => message.type === "ACK" && message.commandId === moveId,
  );
  await until(
    a,
    (message) =>
      message.type === "SNAPSHOT" &&
      message.state.units.some(
        (unit) => unit.ownerId === bob.data.id && unit.destination?.x === 5,
      ),
  );

  b.socket.close();
  b = await connect(match.data.id, bob.cookie);
  await until(
    b,
    (message) =>
      message.type === "SNAPSHOT" && message.state.units.length === 2,
  );
  a.socket.close();
  b.socket.close();
  console.log(
    "Two-player auth, faction colours, ownership, shared state and reconnect passed",
  );
} finally {
  server.kill("SIGTERM");
}
