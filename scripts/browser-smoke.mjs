/* global setTimeout, console, document, fetch */
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const aliceName = `a${suffix}`;
const bobName = `b${suffix}`;
const framesA = [];
const framesB = [];

async function register(page, username) {
  await page.goto("http://localhost:5173/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill("long-test-password");
  await page.locator("#register").click();
  await page.locator("#matches-panel").waitFor({ state: "visible" });
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
  await pageA.locator("#match-name").fill(`Browser test ${suffix}`);
  await pageA.locator("#create-form button").click();
  await pageA.locator("#active-match").waitFor({ state: "visible" });

  await register(pageB, bobName);
  await pageB.locator("#refresh-matches").click();
  await pageB.locator(".match-row button").first().click();
  await pageB.locator("#active-match").waitFor({ state: "visible" });

  await until(() =>
    framesA.some(
      (message) =>
        message.type === "SNAPSHOT" && message.state.units.length === 2,
    ),
  );
  await until(() =>
    framesB.some(
      (message) =>
        message.type === "SNAPSHOT" && message.state.units.length === 2,
    ),
  );
  await pageA.waitForFunction(
    (name) =>
      document.querySelector("#player-list")?.textContent?.includes(name),
    bobName,
  );
  const a = await pageA.evaluate(() =>
    fetch("/api/me").then((response) => response.json()),
  );
  const b = await pageB.evaluate(() =>
    fetch("/api/me").then((response) => response.json()),
  );
  assert.notEqual(a.id, b.id);

  await pageB.reload();
  await pageB.locator("#matches-panel").waitFor({ state: "visible" });
  await pageB.locator(".match-row button").first().click();
  await pageB.locator("#active-match").waitFor({ state: "visible" });
  console.log(
    "Two isolated browser profiles saw the shared match and rejoined after refresh",
  );
} finally {
  await browser.close();
}
