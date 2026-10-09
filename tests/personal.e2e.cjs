const { chromium, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
} = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const origin = "http://127.0.0.1:3127";
mkdirSync("test-results", { recursive: true });
const dir = path.resolve(mkdtempSync("test-results/personal-browser-"));
const topics = [
  "模型与编程",
  "智能体",
  "芯片与基础设施",
  "科研",
  "创作工具",
  "公共治理",
  "产业商业",
];
const news = topics.flatMap((topic, i) =>
  [0, 1].map((j) => ({
    id: `test-${i}-${j}`,
    title: `测试选题：${topic} ${j}`,
    summary: "这是一条仅供功能测试的新闻。",
    topic,
    source: `source-${i}.example`,
    url: `https://source-${i}.example/${j}`,
    date: "2026-10-09",
    evidence: { approved: true, note: "测试证据" },
    importance: 3,
    ...(i === 5
      ? {
          publicAssessment: {
            reach: 4,
            severity: 4,
            urgency: 4,
            reason: "测试用公共影响评估",
          },
        }
      : {}),
  })),
);
news.push({
  ...news[0],
  id: "unverified",
  title: "未核实的新闻",
  evidence: { approved: false, note: "待复核" },
});
writeFileSync(path.join(dir, "news-catalog.json"), JSON.stringify(news));
const server = spawn(process.execPath, ["scripts/start.mjs"], {
  windowsHide: true,
  env: {
    ...process.env,
    NEWS_DATA_DIR: dir,
    NEWS_ORIGIN: origin,
    NEWS_SECURE_COOKIE: "false",
    HOSTNAME: "127.0.0.1",
    PORT: "3127",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "",
  browser;
server.stdout.on("data", (b) => (logs += b));
server.stderr.on("data", (b) => (logs += b));
async function saved(page, action) {
  const wait = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/personal/" + action) &&
      r.request().method() === "POST",
  );
  return wait;
}
async function json(page) {
  return page.evaluate(async () => (await fetch("/api/personal")).json());
}
async function register(page, name) {
  await page.goto(origin + "/personal");
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "注册并开始", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "从你的关注开始" }),
  ).toBeVisible();
}
async function calibrate(page, text) {
  await page.getByLabel("我的新闻需求").fill(text);
  let wait = saved(page, "language");
  await page.getByRole("button", { name: "开始五道偏好题 →" }).click();
  assert.equal((await wait).status(), 200);
  for (let i = 0; i < 5; i++) {
    await expect(
      page.getByText(`已完成 ${i} / 5 题。下一题会根据已有回答调整。`),
    ).toBeVisible();
    if (i === 2) {
      await page.reload();
      await expect(
        page.getByText(`已完成 ${i} / 5 题。下一题会根据已有回答调整。`),
      ).toBeVisible();
    }
    assert.equal((await json(page)).personal.length, 0);
    wait = saved(page, "answer");
    await page.getByRole("button", { name: "两项都无法判断" }).click();
    assert.equal((await wait).status(), 200);
  }
  await expect(
    page.getByRole("heading", { name: "我的新闻规则", exact: true }),
  ).toBeVisible();
}
(async () => {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("Server exited: " + logs);
    try {
      if ((await fetch(origin + "/personal")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  });
  const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://*.example/**", (route) =>
    route.fulfill({ body: "Test source", contentType: "text/plain" }),
  );
  await register(page, "browser-alpha");
  await calibrate(page, "多看科研，少看产业商业");
  let state = await json(page);
  const initialRules = state.profile.rules;
  await page.getByLabel("调整要求").fill("多看这种新闻");
  let wait = saved(page, "language");
  await page.getByRole("button", { name: "应用这句话" }).click();
  assert.equal((await wait).status(), 422);
  assert.deepEqual((await json(page)).profile.rules, initialRules);
  await page.getByLabel("调整要求").fill("多看智能体");
  wait = saved(page, "language");
  await page.getByRole("button", { name: "应用这句话" }).click();
  assert.equal((await wait).status(), 200);
  const relevance = page.getByRole("slider", { name: /个人相关性/ });
  await relevance.fill("80");
  wait = saved(page, "settings");
  await page.getByRole("button", { name: "保存参数并重新排序" }).click();
  assert.equal((await wait).status(), 200);
  assert.equal((await json(page)).profile.rules.weights.relevance, 80);
  await page.getByRole("button", { name: "我的新闻", exact: true }).click();
  const feed = page.getByRole("region", { name: "个人推荐" }),
    pub = page.getByRole("region", { name: "公共重要新闻" });
  await expect(feed.getByText("未核实的新闻")).toHaveCount(0);
  await expect(pub.locator(".pn-card")).toHaveCount(2);
  const card = feed.locator(".pn-card").first(),
    id = await card.getAttribute("data-news-id");
  await card.getByText("为什么推荐给我", { exact: true }).click();
  await expect(card.getByText(/基础分 .*100/)).toBeVisible();
  await expect(card.locator("meter")).toHaveCount(3);
  await card.screenshot({ path: path.join(dir, "score-desktop.png") });
  state = await json(page);
  const target = state.personal.find((n) => n.id === id),
    before = state.profile.rules.topics[target.topic];
  wait = saved(page, "feedback");
  await card.getByRole("button", { name: /多看/ }).click();
  assert.equal((await wait).status(), 200);
  assert.equal(
    (await json(page)).profile.rules.topics[target.topic],
    before + 0.5,
  );
  await page.getByRole("button", { name: "我的规则", exact: true }).click();
  wait = saved(page, "undo");
  await page.getByRole("button", { name: "撤销最近一次调整" }).click();
  assert.equal((await wait).status(), 200);
  assert.equal((await json(page)).profile.rules.topics[target.topic], before);
  await page.getByRole("button", { name: "我的新闻", exact: true }).click();
  const pcard = pub.locator(".pn-card").first(),
    pid = await pcard.getAttribute("data-news-id");
  wait = saved(page, "read");
  const popupPromise = context.waitForEvent("page");
  await pcard.getByRole("link", { name: "阅读来源 ↗" }).click();
  const popup = await popupPromise;
  await wait;
  await popup.close();
  await expect(pub.locator(`[data-news-id="${pid}"] .pn-meta`)).toContainText(
    "已读",
  );
  await expect(feed.locator(`[data-news-id="${pid}"] .pn-meta`)).toContainText(
    "已读",
  );
  wait = saved(page, "display");
  await pub.getByRole("button", { name: "折叠" }).click();
  assert.equal((await wait).status(), 200);
  await page.reload();
  await expect(pub.getByRole("button", { name: "展开" })).toBeVisible();
  wait = saved(page, "display");
  await pub.getByRole("button", { name: "展开" }).click();
  await wait;
  await page.screenshot({
    path: path.join(dir, "desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({ path: path.join(dir, "mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "我的规则", exact: true }).click();
  await page.getByText(/来源偏好 ·/).click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(dir, "settings-mobile.png"),
    fullPage: true,
  });
  const original = await json(page);
  await page
    .getByRole("slider", { name: "内容多样性", exact: true })
    .fill("30");
  wait = saved(page, "preview");
  await page.getByRole("button", { name: "预览调整效果" }).click();
  assert.equal((await wait).status(), 200);
  await expect(
    page.getByRole("heading", { name: "调整后", exact: true }),
  ).toBeVisible();
  assert.deepEqual((await json(page)).profile, original.profile);
  assert.deepEqual((await json(page)).history, original.history);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .getByRole("region", { name: "规则效果预览" })
    .screenshot({ path: path.join(dir, "preview-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("region", { name: "规则效果预览" })
    .screenshot({ path: path.join(dir, "preview-desktop.png") });
  await page
    .getByRole("region", { name: "推荐筛选过程" })
    .first()
    .screenshot({ path: path.join(dir, "audit-desktop.png") });
  await page
    .getByRole("slider", { name: "内容多样性", exact: true })
    .fill("20");
  await expect(
    page.getByRole("heading", { name: "调整后", exact: true }),
  ).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出已保存规则" }).click();
  const download = await downloadPromise;
  const recipe = JSON.parse(readFileSync(await download.path(), "utf8"));
  assert.deepEqual(recipe.rules, original.profile.rules);
  assert.deepEqual(Object.keys(recipe).sort(), [
    "engine",
    "format",
    "rules",
    "version",
  ]);
  recipe.rules.diversity = 25;
  recipe.rules.topics["公共治理"] = -2;
  recipe.rules.sources["new-source.example"] = -2;
  await page
    .getByLabel("导入规则文件")
    .setInputFiles({
      name: "rules.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(recipe)),
    });
  await expect(
    page.getByRole("slider", { name: "内容多样性", exact: true }),
  ).toHaveValue("25");
  await expect(page.getByText(/规则已载入草稿/)).toBeVisible();
  assert.deepEqual((await json(page)).profile, original.profile);
  await page
    .getByLabel("导入规则文件")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...recipe, version: 999 })),
    });
  await expect(page.getByText(/规则文件格式、版本或参数无效/)).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "内容多样性", exact: true }),
  ).toHaveValue("25");
  wait = saved(page, "settings");
  await page.getByRole("button", { name: "保存参数并重新排序" }).click();
  assert.equal((await wait).status(), 200);
  const imported = await json(page);
  assert.equal(imported.profile.rules.diversity, 25);
  assert.ok(imported.personal.every((n) => n.topic !== "公共治理"));
  assert.equal(imported.publicNews.length, 2);
  wait = saved(page, "undo");
  await page.getByRole("button", { name: "撤销最近一次调整" }).click();
  await wait;
  assert.deepEqual((await json(page)).profile.rules, original.profile.rules);
  const rulesA = (await json(page)).profile;
  const beta = await browser.newContext({
      viewport: { width: 375, height: 900 },
    }),
    second = await beta.newPage();
  await register(second, "browser-beta");
  await calibrate(second, "多看模型");
  const dataB = await json(second);
  assert.notEqual(dataB.personal[0].id, (await json(page)).personal[0].id);
  assert.equal(
    dataB.publicNews.every((n) => !n.read),
    true,
  );
  assert.equal(dataB.publicCollapsed, false);
  assert.deepEqual((await json(page)).profile, rulesA);
  assert.equal(
    (await second.request.get(origin + "/api/annotations")).status(),
    403,
  );
  await second.goto(origin);
  await expect(second).toHaveURL(origin + "/personal");
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("button", { name: "已有账号？登录" }).click();
  await page.getByLabel("用户名", { exact: true }).fill("browser-alpha");
  await page.getByLabel("密码", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "我的新闻", exact: true }),
  ).toBeVisible();
  assert.deepEqual((await json(page)).profile, rulesA);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks:
        "registration, calibration, language, settings, feedback, undo, public news, read sync, isolation, login persistence, score breakdown, audit, draft preview, stale preview invalidation, private rules export, validated import, dormant sources, import undo, desktop and mobile",
      screenshots: dir,
    }),
  );
})()
  .catch((e) => {
    console.error(e);
    console.error(logs.slice(-4000));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server.exitCode === null) {
      const done = new Promise((r) => server.once("exit", r));
      server.kill();
      await done;
    }
  });
