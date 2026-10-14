/* global process, fetch, setTimeout, console */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import WebSocket from "ws";

const port = 3101;
const base = `http://127.0.0.1:${port}`;
function startServer() {
  return spawn(process.execPath, ["apps/server/dist/index.js"], {
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL_TEST,
      SERVER_PORT: String(port),
    },
    stdio: "ignore",
  });
}
let server = startServer();
let fixtureId;
let fixtureCookie;

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
      ...(body === undefined ? {} : { "content-type": "application/json" }),
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
  for (let attempt = 0; attempt < 300; attempt++) {
    const found = session.received.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for WebSocket message. Latest snapshot: ${JSON.stringify(
      session.received
        .filter((message) => message.type === "SNAPSHOT")
        .at(-1)
        ?.state.units.map((unit) => ({
          id: unit.id,
          x: unit.position.x,
          targetId: unit.targetId,
        })),
    )}; message types: ${session.received
      .slice(-10)
      .map((message) => message.type)
      .join(",")}`,
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
  fixtureId = match.data.id;
  fixtureCookie = alice.cookie;
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
      message.type === "SNAPSHOT" && message.state.units.length === 3,
  );
  await until(
    b,
    (message) =>
      message.type === "SNAPSHOT" && message.state.units.length === 3,
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
      message.type === "SNAPSHOT" &&
      message.state.units.some((unit) => unit.ownerId === bob.data.id),
  );
  const attackId = randomUUID();
  a.socket.send(
    JSON.stringify({
      protocolVersion: 1,
      commandId: attackId,
      type: "ATTACK_UNIT",
      unitId: `artillery-${alice.data.id}`,
      targetId: `unit-${bob.data.id}`,
    }),
  );
  await until(
    a,
    (message) => message.type === "ACK" && message.commandId === attackId,
  );
  await until(
    a,
    (message) =>
      message.type === "SNAPSHOT" &&
      message.state.combatEvents.some(
        (event) => event.attackerId === `artillery-${alice.data.id}`,
      ),
  );
  await until(
    a,
    (message) =>
      message.type === "SNAPSHOT" &&
      message.state.combatEvents.some(
        (event) => event.targetId === `unit-${bob.data.id}` && event.destroyed,
      ),
  );
  b.socket.close();
  b = await connect(match.data.id, bob.cookie);
  const afterDeath = await until(
    b,
    (message) =>
      message.type === "SNAPSHOT" &&
      message.state.units.some((unit) => unit.id === `medium-${bob.data.id}`),
  );
  assert.equal(
    afterDeath.state.units.some((unit) => unit.id === `unit-${bob.data.id}`),
    false,
  );
  const buildId = randomUUID();
  a.socket.send(
    JSON.stringify({
      protocolVersion: 1,
      commandId: buildId,
      type: "BUILD_STRUCTURE",
      kind: "extractor",
      nodeId: `node-${alice.data.id}`,
    }),
  );
  await until(
    a,
    (message) => message.type === "ACK" && message.commandId === buildId,
  );
  const marchId = randomUUID();
  a.socket.send(
    JSON.stringify({
      protocolVersion: 1,
      commandId: marchId,
      type: "MOVE_UNIT",
      unitId: `medium-${alice.data.id}`,
      destination: { x: 15, z: -4 },
    }),
  );
  await until(
    a,
    (message) => message.type === "ACK" && message.commandId === marchId,
  );
  await until(
    a,
    (message) =>
      message.type === "SNAPSHOT" &&
      message.state.buildings.some(
        (building) => building.id === `extractor-${alice.data.id}`,
      ) &&
      message.state.units.some(
        (unit) =>
          unit.id === `medium-${alice.data.id}` && unit.destination?.x === 15,
      ),
  );
  a.socket.close();
  b.socket.close();
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGKILL");
  await stopped;
  await new Promise((resolve) => setTimeout(resolve, 11_000));
  server = startServer();
  await waitForServer();
  const afterRestart = await connect(match.data.id, bob.cookie);
  const recovered = await until(
    afterRestart,
    (message) =>
      message.type === "SNAPSHOT" &&
      message.state.units.some((unit) => unit.id === `medium-${bob.data.id}`),
  );
  assert.equal(
    recovered.state.units.some((unit) => unit.id === `unit-${bob.data.id}`),
    false,
  );
  const afterRestartA = await connect(match.data.id, alice.cookie);
  const recoveredA = await until(
    afterRestartA,
    (message) => message.type === "SNAPSHOT",
  );
  const extractor = recoveredA.state.buildings.find(
    (building) => building.id === `extractor-${alice.data.id}`,
  );
  assert.ok(extractor);
  assert.ok(extractor.readyAtMs <= Date.now());
  assert.ok(
    recoveredA.state.resources.find(
      (balance) => balance.playerId === alice.data.id,
    )?.ore >= 60,
  );
  const marching = recoveredA.state.units.find(
    (unit) => unit.id === `medium-${alice.data.id}`,
  );
  assert.equal(marching?.destination?.x, 15);
  assert.ok(
    marching.position.x < 0,
    "movement must pause during server downtime",
  );
  const forbiddenDelete = await request(
    `/matches/${match.data.id}`,
    "DELETE",
    undefined,
    bob.cookie,
  );
  assert.equal(forbiddenDelete.status, 403);
  const deleted = await request(
    `/matches/${match.data.id}`,
    "DELETE",
    undefined,
    alice.cookie,
  );
  assert.equal(deleted.status, 200);
  assert.equal(
    (await request("/matches")).data.some((item) => item.id === match.data.id),
    false,
  );
  afterRestart.socket.close();
  afterRestartA.socket.close();
  console.log(
    "Combat and construction survived restart; only the creator deleted the match",
  );
} finally {
  if (fixtureId && fixtureCookie)
    try {
      await request(
        `/matches/${fixtureId}`,
        "DELETE",
        undefined,
        fixtureCookie,
      );
    } catch {
      /* The server may already be down after a crash test failure. */
    }
  server.kill("SIGTERM");
}
