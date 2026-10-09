const { chromium, expect } = require("@playwright/test");
const { spawn, spawnSync } = require("node:child_process");
const {
  mkdirSync,
  mkdtempSync,
  existsSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");
const { randomBytes, scryptSync, randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");

const origin = "http://127.0.0.1:3107";
mkdirSync("test-results", { recursive: true });
const dataDir = path.resolve(mkdtempSync("test-results/browser-"));
const password = randomBytes(18).toString("hex"),
  salt = randomBytes(16).toString("hex");
const env = {
  ...process.env,
  NEWS_DATA_DIR: dataDir,
  NEWS_USERNAME: "test-reader",
  NEWS_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  NEWS_SECURE_COOKIE: "false",
  NEWS_ORIGIN: origin,
  HOSTNAME: "127.0.0.1",
  PORT: "3107",
  NEXT_TELEMETRY_DISABLED: "1",
};
let server,
  browser,
  logs = "";
function launch() {
  server = spawn(process.execPath, ["scripts/start.mjs"], {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => (logs += chunk));
  server.stderr.on("data", (chunk) => (logs += chunk));
  return server;
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Server did not start: " + logs);
}
async function stop() {
  if (server && !server.killed) {
    const ended = new Promise((r) => server.once("exit", r));
    server.kill();
    await ended;
  }
}
async function login(page) {
  await page.goto(origin);
  await page.getByLabel("用户名", { exact: true }).fill("test-reader");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入阅报室 →" }).click();
  await page.locator("#page-1[data-rendered=true]").waitFor({ timeout: 60000 });
}
async function selectText(page, { crossPage = false } = {}) {
  return page.evaluate(
    ({ crossPage }) => {
      const spans = [
        ...document.querySelectorAll("#page-1 .textLayer span"),
      ].filter(
        (el) => el.firstChild?.nodeType === 3 && el.textContent.length > 20,
      );
      if (!spans.length) throw new Error("No selectable Chinese body text");
      const first =
        spans.find(
          (el) =>
            el.textContent.includes("OpenAI") &&
            el.textContent.includes("推出"),
        ) ||
        spans.find((el) => el.textContent.includes("开始")) ||
        spans[0];
      let last = first;
      const firstBox = first.getBoundingClientRect();
      // Select two adjacent same-column lines when available.
      const candidate = spans[spans.indexOf(first) + 1];
      if (
        candidate &&
        Math.abs(candidate.getBoundingClientRect().left - firstBox.left) < 10 &&
        Math.abs(candidate.getBoundingClientRect().top - firstBox.top) <
          firstBox.height * 2
      )
        last = candidate;
      if (crossPage)
        last = [...document.querySelectorAll("#page-2 .textLayer span")].find(
          (el) => el.firstChild?.nodeType === 3 && el.textContent.length > 10,
        );
      if (!last) throw new Error("No second page text");
      const range = document.createRange();
      range.setStart(first.firstChild, 0);
      range.setEnd(last.firstChild, Math.min(last.textContent.length, 18));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      first.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return selection.toString();
    },
    { crossPage },
  );
}
(async () => {
  const imported = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/import-pdfs.ts"],
    { env, windowsHide: true, encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);
  launch();
  await ready();
  const chrome =
    process.env.CHROME_PATH ||
    (existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
      ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
      : undefined);
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const anonymous = await context.request.get(origin + "/api/editions");
  assert.equal(anonymous.status(), 401);
  const crossOrigin = await context.request.post(origin + "/api/login", {
    headers: { Origin: "https://elsewhere.invalid" },
    data: { username: "test-reader", password },
  });
  assert.equal(crossOrigin.status(), 403);
  await login(page);
  const editions = await (
    await context.request.get(origin + "/api/editions")
  ).json();
  assert.equal(editions.length, 7);
  const id = editions[0].id;
  const anonymousContext = await browser.newContext();
  assert.equal(
    (await anonymousContext.request.get(origin + `/api/pdf/${id}`)).status(),
    401,
  );
  await anonymousContext.close();
  const quote = await selectText(page);
  assert.ok(quote.length > 15);
  await page.getByRole("button", { name: "▰ 高亮", exact: true }).click();
  await expect(page.locator(".annotation.highlight").first()).toBeVisible();
  let notes = await (
    await context.request.get(origin + "/api/annotations")
  ).json();
  assert.equal(notes.length, 1);
  let note = notes[0];
  assert.equal(note.quote, quote);
  assert.ok(note.rects.length >= 1);
  assert.ok(
    note.rects.every((r) => r[2] - r[0] < 400),
    "Selection must not cover adjacent columns",
  );
  const duplicated = await context.request.post(origin + "/api/annotations", {
    headers: { Origin: origin },
    data: note,
  });
  assert.equal(duplicated.status(), 201);
  assert.equal(
    (await (await context.request.get(origin + "/api/annotations")).json())
      .length,
    1,
  );
  const bad = await context.request.post(origin + "/api/annotations", {
    headers: { Origin: origin },
    data: { ...note, id: randomUUID(), rects: [[-100, 0, 20, 20]] },
  });
  assert.equal(bad.status(), 400);
  await page.screenshot({ path: "test-results/reader-desktop.png" });
  const before = await page.locator(".annotation").first().boundingBox();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await page.waitForTimeout(500);
  const after = await page.locator(".annotation").first().boundingBox();
  assert.ok(after.width > before.width * 1.15);
  await page.reload();
  await page.locator("#page-1[data-rendered=true]").waitFor();
  await expect(page.locator(".annotation").first()).toBeVisible();
  await page.locator(".note-meta button").first().click();
  await page
    .getByLabel("我的想法", { exact: true })
    .fill("值得持续关注的方向。");
  await page.getByLabel("标注方式", { exact: true }).selectOption("underline");
  await page.getByRole("button", { name: "蓝色", exact: true }).click();
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  note = (
    await (await context.request.get(origin + "/api/annotations")).json()
  )[0];
  assert.equal(note.kind, "underline");
  assert.equal(note.color, "blue");
  assert.equal(note.note, "值得持续关注的方向。");
  // A second authenticated device sees saved notes and edits the same version.
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (error) => errors.push(error.message));
  await login(mobile);
  await mobile.getByRole("button", { name: /^笔记 / }).click();
  await expect(mobile.locator(".note-content")).toContainText("值得持续关注");
  await mobile.locator(".note-meta button").first().click();
  await mobile.getByLabel("我的想法", { exact: true }).fill("手机端保留的草稿");
  await page.locator(".note-meta button").first().click();
  await page.getByLabel("我的想法", { exact: true }).fill("电脑端最新修改");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await mobile.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(
    mobile.getByRole("button", { name: "查看服务器最新版本，保留我的草稿" }),
  ).toBeVisible();
  await expect(mobile.getByLabel("我的想法", { exact: true })).toHaveValue(
    "手机端保留的草稿",
  );
  await mobile
    .getByRole("button", { name: "查看服务器最新版本，保留我的草稿" })
    .click();
  await expect(mobile.locator(".editor-status")).toContainText(
    "电脑端最新修改",
  );
  await mobile.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(mobile.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".note-content")).toContainText("手机端保留的草稿");
  // Offline save preserves the draft across a reload once online again.
  await mobile.locator(".note-meta button").first().click();
  await mobile.getByLabel("我的想法", { exact: true }).fill("断网仍保留的文字");
  await mobileContext.setOffline(true);
  await mobile.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(mobile.locator(".editor-status")).toContainText("草稿已保留");
  await mobileContext.setOffline(false);
  await mobile.reload();
  await mobile.locator("#page-1[data-rendered=true]").waitFor();
  await mobile.locator(".draft-tray summary").click();
  await mobile.locator(".draft-tray button").first().click();
  await expect(mobile.getByLabel("我的想法", { exact: true })).toHaveValue(
    "断网仍保留的文字",
  );
  await mobile.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(mobile.getByRole("dialog")).toHaveCount(0);
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await mobile.screenshot({ path: "test-results/reader-mobile.png" });
  const portrait = await mobile.locator(".annotation").first().boundingBox();
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.waitForTimeout(700);
  const landscape = await mobile.locator(".annotation").first().boundingBox();
  assert.ok(landscape.width > portrait.width);
  // Search and jump retain edition identity and the marked page.
  await page.getByRole("button", { name: /^我的笔记/ }).click();
  await page.getByLabel("搜索笔记").fill("断网仍保留");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".note-card")).toHaveCount(1);
  await page.locator(".quote").click();
  await page.locator("#page-1[data-rendered=true]").waitFor();
  assert.ok(page.url().includes(`edition=${id}`));
  // A selection spanning two pages must not create malformed coordinates.
  await page.locator("#page-2[data-rendered=true]").waitFor();
  await selectText(page, { crossPage: true });
  await expect(page.getByRole("status").last()).toContainText("同一页");
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.getByLabel("页码", { exact: true }).selectOption("3");
  await page.waitForTimeout(1200);
  await page.reload();
  await page.locator("#page-1[data-rendered=true]").waitFor();
  await expect(page.getByLabel("页码", { exact: true })).toHaveValue("3");
  // Restart preserves both server-side notes and the session.
  await stop();
  launch();
  await ready();
  await page.reload();
  await page.locator("#page-1[data-rendered=true]").waitFor();
  notes = await (await context.request.get(origin + "/api/annotations")).json();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].note, "断网仍保留的文字");
  // Delete on device A is removed from B on refresh.
  const removed = await context.request.delete(
    origin + `/api/annotations/${notes[0].id}`,
    { headers: { Origin: origin }, data: { version: notes[0].version } },
  );
  assert.equal(removed.status(), 200);
  await mobile.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(mobile.locator(".annotation")).toHaveCount(0);
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "进入阅报室 →" }),
  ).toBeVisible();
  assert.equal(
    (await context.request.get(origin + `/api/pdf/${id}`)).status(),
    401,
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    "test-results/browser-summary.json",
    JSON.stringify(
      {
        passed: true,
        editions: 7,
        checks: [
          "private access",
          "CSRF",
          "Chinese multi-line selection",
          "highlight",
          "zoom",
          "reload",
          "underline",
          "color",
          "mobile layout",
          "two-device sync",
          "revision conflict",
          "offline draft recovery",
          "search and jump",
          "cross-page rejection",
          "reading position",
          "restart persistence",
          "deletion sync",
          "logout",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Browser checks passed: selection, highlights, private access, drafts, synchronization, conflict handling, restart, desktop and mobile.",
  );
})()
  .catch((error) => {
    console.error(error);
    writeFileSync("test-results/server.log", logs);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    await stop();
  });
