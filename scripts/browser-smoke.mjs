/* global setTimeout, clearTimeout, console, document, fetch, WebSocket, location */
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const aliceName = `a${suffix}`;
const bobName = `b${suffix}`;
const matchName = `Browser test ${suffix}`;
const framesA = [];
const framesB = [];

async function register(page, username) {
  await page.goto("http://localhost:5173/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill("long-test-password");
  await page.locator("#register").click();
  await page.locator("#matches-panel").waitFor({ state: "visible" });
  await page.locator("#hide-test-matches").uncheck();
}

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for shared browser state");
}

function collect(page, frames) {
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      try {
        frames.push(JSON.parse(String(payload)));
      } catch {
        /* Ignore non-JSON frames. */
      }
    });
  });
}

try {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  collect(pageA, framesA);
  collect(pageB, framesB);

  await register(pageA, aliceName);
  await pageA.locator("#match-name").fill(matchName);
  await pageA.locator("#create-form button").click();
  await pageA.locator("#active-match").waitFor({ state: "visible" });
  assert.equal(
    await pageA.locator(".armies").evaluate((panel) => panel.open),
    false,
  );
  assert.equal(
    await pageA.evaluate(() => {
      const panel = document.querySelector(".armies")?.getBoundingClientRect();
      const economy = document
        .querySelector(".economy")
        ?.getBoundingClientRect();
      return (
        !!panel &&
        !!economy &&
        panel.left >= economy.left &&
        panel.right <= economy.right
      );
    }),
    true,
  );

  await register(pageB, bobName);
  await pageB.locator("#refresh-matches").click();
  await pageB
    .locator(".match-row")
    .filter({ hasText: matchName })
    .locator("button")
    .first()
    .click();
  await pageB.locator("#active-match").waitFor({ state: "visible" });
  console.log("Browser smoke: both players joined");

  await until(() =>
    framesA.some(
      (message) =>
        message.type === "SNAPSHOT" && message.state.units.length === 3,
    ),
  );
  await until(() =>
    framesB.some(
      (message) =>
        message.type === "SNAPSHOT" && message.state.units.length === 3,
    ),
  );
  await pageA.waitForFunction(
    (name) =>
      document.querySelector("#player-list")?.textContent?.includes(name),
    bobName,
  );
  console.log("Browser smoke: each player sees only their own distant army");
  const a = await pageA.evaluate(() =>
    fetch("/api/me").then((response) => response.json()),
  );
  const b = await pageB.evaluate(() =>
    fetch("/api/me").then((response) => response.json()),
  );
  assert.notEqual(a.id, b.id);

  await pageA.locator("#build-extractor").click();
  await until(() =>
    framesA.some(
      (message) =>
        message.type === "SNAPSHOT" &&
        message.state.buildings.some(
          (building) => building.id === `extractor-${a.id}`,
        ),
    ),
  );
  await pageA.locator("#build-factory").click();
  await until(() =>
    framesA.some(
      (message) =>
        message.type === "SNAPSHOT" &&
        message.state.buildings.some(
          (building) => building.id === `factory-${a.id}`,
        ),
    ),
  );
  await pageA.waitForFunction(() =>
    document.querySelector("#ore-balance")?.textContent?.includes("Ore: 0"),
  );
  console.log("Browser smoke: economy orders accepted");

  await pageA.locator("#unit-roster button").first().click();
  assert.match(await pageA.locator("#selection").textContent(), /selected/);
  const matchId = framesA.find(
    (message) => message.type === "WELCOME",
  )?.matchId;
  assert.ok(matchId);
  async function sendCommand(command) {
    await pageA.evaluate(
      async ({ matchId, command }) => {
        const connection = new WebSocket(
          `ws://${location.host}/ws?matchId=${matchId}`,
        );
        try {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Attack acknowledgement timed out")),
              10000,
            );
            connection.addEventListener("error", reject);
            connection.addEventListener("message", (event) => {
              const message = JSON.parse(event.data);
              if (message.type === "WELCOME")
                connection.send(
                  JSON.stringify({
                    protocolVersion: 1,
                    ...command,
                  }),
                );
              if (
                message.type === "ACK" &&
                message.commandId === command.commandId
              ) {
                clearTimeout(timer);
                resolve(undefined);
              }
              if (message.type === "ERROR") {
                clearTimeout(timer);
                reject(new Error(message.message));
              }
            });
          });
        } finally {
          connection.close();
        }
      },
      { matchId, command },
    );
  }
  await sendCommand({
    commandId: randomUUID(),
    type: "MOVE_UNIT",
    unitId: `artillery-${a.id}`,
    destination: { x: 0, z: 0 },
  });
  await until(() =>
    framesA.some(
      (message) =>
        message.type === "SNAPSHOT" &&
        message.state.units.find((unit) => unit.id === `artillery-${a.id}`)
          ?.position.x >= 0,
    ),
  );
  await until(() =>
    framesA.some(
      (message) =>
        message.type === "SNAPSHOT" &&
        message.state.units.some((unit) => unit.id === `unit-${b.id}`),
    ),
  );
  await sendCommand({
    commandId: randomUUID(),
    type: "ATTACK_UNIT",
    unitId: `artillery-${a.id}`,
    targetId: `unit-${b.id}`,
  });
  await pageA.waitForFunction(
    () => document.querySelector("#combat-log")?.textContent?.includes("hit"),
    null,
    { timeout: 15000 },
  );
  console.log("Browser smoke: combat visible");

  await pageB.reload();
  await pageB.locator("#matches-panel").waitFor({ state: "visible" });
  await pageB.locator("#hide-test-matches").uncheck();
  await pageB
    .locator(".match-row")
    .filter({ hasText: matchName })
    .locator("button")
    .first()
    .click();
  await pageB.locator("#active-match").waitFor({ state: "visible" });
  await pageA.reload();
  await pageA.locator("#matches-panel").waitFor({ state: "visible" });
  await pageA.locator("#hide-test-matches").uncheck();
  await pageA
    .locator(".match-row")
    .filter({ hasText: matchName })
    .locator("button")
    .first()
    .click();
  await pageA.locator("#active-match").waitFor({ state: "visible" });
  await pageA.waitForFunction(
    () =>
      /^Ore: \d+/.test(
        document.querySelector("#ore-balance")?.textContent ?? "",
      ) &&
      document.querySelector("#build-extractor")?.hasAttribute("disabled") &&
      document.querySelector("#build-factory")?.hasAttribute("disabled"),
  );
  console.log("Browser smoke: economy restored after refresh");
  await pageA.locator(".armies summary").click();
  await pageA.locator('#army-unit-list input[type="checkbox"]').first().check();
  await pageA.locator("#army-name").fill("Browser Alpha");
  await pageA.locator('#create-army-form button[type="submit"]').click();
  await pageA
    .locator("#army-select option")
    .first()
    .waitFor({ state: "attached" });
  await pageA.locator("#army-x").fill("-10");
  await pageA.locator("#army-z").fill("0");
  await pageA.locator("#army-stance").selectOption("defend");
  await pageA.locator('#order-army-form button[type="submit"]').click();
  await pageA.waitForFunction(
    () =>
      document
        .querySelector("#battle-reports")
        ?.textContent?.includes("Browser Alpha reached its defend position"),
    null,
    { timeout: 20000 },
  );
  console.log("Browser smoke: named army arrived and reported");
  await pageA.locator("#leave-match").click();
  await pageA
    .locator(".match-row")
    .filter({ hasText: matchName })
    .waitFor({ state: "visible" });
  pageA.once("dialog", (dialog) => void dialog.accept());
  await pageA
    .locator(".match-row")
    .filter({ hasText: matchName })
    .locator(".delete-match")
    .click();
  await pageA
    .locator(".match-row")
    .filter({ hasText: matchName })
    .waitFor({ state: "detached" });
  await pageB.locator("#matches-panel").waitFor({ state: "visible" });
  console.log(
    "Two browser profiles saw economy and combat, rejoined, and the creator deleted the match",
  );
} finally {
  await browser.close();
}
