import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scryptSync } from "node:crypto";
import { NextRequest } from "next/server";
import {
  adjustPreference,
  defaultRules,
  initialProfile,
  interpret,
  learn,
  nextQuestion,
  rank,
  rankWithAudit,
} from "../lib/personal-engine";
import { exportRecipe, importRecipe } from "../lib/personal-rules";
import { topics, type News, type PersonalView } from "../lib/personal-types";

mkdirSync("test-results", { recursive: true });
process.env.NEWS_DATA_DIR = mkdtempSync("test-results/personal-");
process.env.NEWS_USERNAME = "owner-test";
process.env.NEWS_PASSWORD_HASH =
  "test-salt:" +
  scryptSync("test-owner-password", "test-salt", 64).toString("hex");
const articles: News[] = topics.flatMap((topic, i) =>
  [0, 1].map((j) => ({
    id: `news-${i}-${j}`,
    topic,
    title: `测试新闻 ${topic} ${j}`,
    summary: "仅用于测试的新闻材料",
    source: `source-${i}.example`,
    url: `https://source-${i}.example/${j}`,
    date: "2026-10-09",
    evidence: { approved: true, note: "测试证据合格" },
    importance: 3,
    ...(topic === "公共治理"
      ? {
          publicAssessment: {
            reach: 5,
            severity: 4,
            urgency: 4,
            reason: "测试公共影响",
          },
        }
      : {}),
  })),
);
articles.push({
  ...articles[0],
  id: "unverified",
  evidence: { approved: false, note: "待核实" },
  importance: 5,
  publicAssessment: {
    reach: 5,
    severity: 5,
    urgency: 5,
    reason: "不能覆盖证据门槛",
  },
});
writeFileSync(
  path.join(process.env.NEWS_DATA_DIR, "news-catalog.json"),
  JSON.stringify(articles),
);
const { POST: handle } = await import("../app/api/[...route]/route");
const { db, Conflict } = await import("../lib/store");
const { getProfile, mutate, undo, view } =
  await import("../lib/personal-store");
const { validateCatalog } = await import("../lib/news-catalog");
async function api(
  route: string,
  cookie = "",
  body?: unknown,
  origin = "http://localhost:4000",
) {
  const headers: Record<string, string> = { cookie, host: "localhost:4000" };
  if (body !== undefined) {
    headers.origin = origin;
    headers["content-type"] = "application/json";
  }
  return handle(
    new NextRequest("http://localhost:4000/api/" + route, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ route: route.split("?")[0].split("/") }) },
  );
}
async function account(name: string) {
  const response = await api("register", "", {
    username: name,
    password: "secure-test-password",
  });
  assert.equal(response.status, 201);
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function state(cookie: string): Promise<PersonalView> {
  return (await api("personal", cookie)).json();
}
async function complete(cookie: string, text = "多看科研") {
  let response = await api("personal/language", cookie, { version: 0, text });
  assert.equal(response.status, 200);
  let data: PersonalView = await response.json();
  for (let i = 0; i < 5; i++) {
    assert.equal(data.personal.length, 0);
    assert.equal(data.publicNews.length, 0);
    response = await api("personal/answer", cookie, {
      version: data.profile.version,
      newsId: data.question!.id,
      interest: null,
      importance: null,
    });
    assert.equal(response.status, 200);
    data = await response.json();
  }
  return data;
}

test("unknown judgments stay neutral; interest and importance are independent", () => {
  const rules = defaultRules(),
    n = articles[0];
  assert.deepEqual(
    learn(rules, n, { newsId: n.id, interest: null, importance: null }),
    rules,
  );
  const learned = learn(rules, n, { newsId: n.id, interest: 0, importance: 5 });
  assert.equal(learned.topics[n.topic], -0.5);
  assert.equal(learned.importance[n.topic], 0.5);
});
test("learning and repeated negative feedback never create a block or increase a low preference", () => {
  assert.equal(adjustPreference(-1.9, -0.5), -1.9);
  assert.equal(adjustPreference(-1.8, -0.5), -1.9);
  assert.equal(adjustPreference(0.1, 0.2), 0.3);
  assert.ok(interpret("恢复科研默认多看模型").unresolved.length);
});
test("follow-up selection responds to high ratings and never repeats a question", () => {
  const p = initialProfile();
  p.description = "多看编程";
  p.rules.topics["模型与编程"] = 1;
  const first = nextQuestion(p, articles)!;
  p.answers.push({ newsId: first.id, interest: 5, importance: 5 });
  assert.equal(nextQuestion(p, articles)!.topic, first.topic);
  assert.notEqual(nextQuestion(p, articles)!.id, first.id);
  p.answers[0] = { newsId: first.id, interest: null, importance: null };
  assert.notEqual(nextQuestion(p, articles)!.topic, first.topic);
});
test("language rejects unhandled qualifications, negation, mixed intents and source constraints", () => {
  for (const text of [
    "不是不喜欢科研",
    "不减少科研",
    "多看科研少看模型",
    "多看来自OpenAI的科研",
    "只看科研",
    "关注科研和体育",
  ])
    assert.ok(interpret(text).unresolved.length, text);
  assert.equal(interpret("对科研不感兴趣").changes[0].value, -1);
  assert.deepEqual(interpret("多看编程和智能体，少看产业商业").unresolved, []);
  assert.equal(interpret("恢复智能体默认").changes[0].value, 0);
});
test("personal preferences change ranking, public importance and evidence gates stay independent", () => {
  const a = initialProfile(),
    b = initialProfile();
  a.rules.topics["科研"] = 2;
  b.rules.topics["模型与编程"] = 2;
  const f1 = rank(a, articles, new Set()),
    f2 = rank(b, articles, new Set());
  assert.notEqual(f1.personal[0].id, f2.personal[0].id);
  a.rules.topics["公共治理"] = -2;
  a.rules.locks.push("公共治理");
  a.rules.sources["source-5.example"] = -2;
  const blocked = rank(a, articles, new Set([f1.publicNews[0].id]));
  assert.deepEqual(
    blocked.publicNews.map((n) => n.id),
    f1.publicNews.map((n) => n.id),
  );
  assert.equal(blocked.publicNews[0].read, true);
  assert.equal(blocked.publicNews[0].duplicate, false);
  assert.ok(f1.publicNews.every((n) => n.duplicate));
  assert.equal(
    blocked.personal.some((n) => n.topic === "公共治理"),
    false,
  );
  assert.equal(
    [...f1.personal, ...f1.publicNews].some((n) => n.id === "unverified"),
    false,
  );
  assert.deepEqual(rank(a, [], new Set()), { personal: [], publicNews: [] });
});

const screenshotPreference = "多看AI使用技巧和ai能力突破进展，少看商业或者娱乐";
test("natural topic aliases and negative alternatives preserve every preference", () => {
  for (const text of [
    screenshotPreference,
    "多看 AI 使用技巧和 AI 能力突破进展，少看商业或娱乐",
    "多看人工智能使用技巧和人工智能能力突破进展；少看商业和娱乐",
  ]) {
    assert.deepEqual(interpret(text), {
      changes: [
        { topic: "模型与编程", value: 1 },
        { topic: "产业商业", value: -1 },
        { topic: "娱乐", value: -1 },
      ],
      unresolved: [],
    });
  }
  for (const text of [
    "多看科研或者娱乐",
    "少看商业或者体育",
    "不是少看商业或者娱乐",
    "多看AI使用技巧，少看模型",
    "少看商业还是娱乐？",
  ])
    assert.ok(interpret(text).unresolved.length, text);
});

test("screenshot request saves, resumes onboarding, affects ranking and can be undone later", async () => {
  const cookie = await account("screenshot-user");
  const response = await api("personal/language", cookie, {
    version: 0,
    text: screenshotPreference,
  });
  assert.equal(response.status, 200);
  const saved: PersonalView = await response.json();
  assert.equal(saved.profile.description, screenshotPreference);
  assert.equal(saved.profile.rules.topics["模型与编程"], 1);
  assert.equal(saved.profile.rules.topics["产业商业"], -1);
  assert.equal(saved.profile.rules.topics["娱乐"], -1);
  assert.deepEqual(saved.profile.rules.locks, []);
  assert.ok(saved.question);
  assert.deepEqual((await state(cookie)).profile, saved.profile);
  const ranked = rank(
    saved.profile,
    articles,
    new Set(),
    Date.parse("2026-10-09"),
  );
  assert.ok(
    ranked.personal.find((n) => n.topic === "模型与编程")!.score >
      ranked.personal.find((n) => n.topic === "娱乐")!.score,
  );

  const laterCookie = await account("screenshot-later");
  const before = await complete(laterCookie);
  const changed = await api("personal/language", laterCookie, {
    version: before.profile.version,
    text: screenshotPreference,
  });
  assert.equal(changed.status, 200);
  const after: PersonalView = await changed.json();
  assert.equal(after.profile.rules.topics["娱乐"], -1);
  const rejected = await api("personal/language", laterCookie, {
    version: after.profile.version,
    text: "多看科研，少看商业或者体育",
  });
  assert.equal(rejected.status, 422);
  assert.match((await rejected.json()).error, /少看商业或者体育/);
  assert.deepEqual((await state(laterCookie)).profile, after.profile);
  const undone = await api("personal/undo", laterCookie, {
    version: after.profile.version,
  });
  assert.equal(undone.status, 200);
  assert.deepEqual((await undone.json()).profile.rules, before.profile.rules);
});

test("legacy profiles, undo snapshots and shared recipes gain neutral entertainment scores", () => {
  const old = JSON.parse(JSON.stringify(initialProfile()));
  delete old.rules.topics.娱乐;
  delete old.rules.importance.娱乐;
  old.description = "旧需求";
  old.version = 2;
  const before = structuredClone(old.rules);
  old.rules.topics.科研 = 1;
  db.prepare("INSERT INTO personal_profiles VALUES (?,?)").run(
    "legacy-language",
    JSON.stringify(old),
  );
  db.prepare(
    "INSERT INTO personal_changes (id,userId,beforeRules,afterRules,message,at,undoable) VALUES (?,?,?,?,?,?,?)",
  ).run(
    "legacy-language-change",
    "legacy-language",
    JSON.stringify(before),
    JSON.stringify(old.rules),
    "旧调整",
    "2026-10-09",
    1,
  );
  const loaded = getProfile("legacy-language");
  assert.equal(loaded.rules.topics.娱乐, 0);
  assert.equal(loaded.rules.importance.娱乐, 0);
  assert.equal(loaded.version, 2);
  assert.ok(
    rank(loaded, articles, new Set()).personal.every((n) =>
      Number.isFinite(n.score),
    ),
  );
  const recipe = { ...exportRecipe(defaultRules()), rules: old.rules };
  assert.equal(importRecipe(JSON.stringify(recipe)).topics.娱乐, 0);
  undo("legacy-language", 2);
  assert.equal(getProfile("legacy-language").rules.topics.科研, 0);
  assert.equal(getProfile("legacy-language").rules.topics.娱乐, 0);
});
test("new users cannot read or change private owner records, sessions and origin are enforced", async () => {
  const cookie = await account("privacy-user");
  assert.equal((await api("personal")).status, 401);
  for (const route of ["editions", "annotations", "progress/any", "pdf/any"])
    assert.equal((await api(route, cookie)).status, 403);
  assert.equal(
    (
      await api(
        "personal/language",
        cookie,
        { version: 0, text: "多看科研" },
        "https://other.example",
      )
    ).status,
    403,
  );
  const owner = await api("login", "", {
    username: "owner-test",
    password: "test-owner-password",
  });
  assert.equal(owner.status, 200);
  const ownerCookie = owner.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await api("editions", ownerCookie)).status, 200);
  assert.equal(
    (await api("session", ownerCookie).then((r) => r.json())).owner,
    true,
  );
  assert.equal(
    (await api("login", "", { username: "privacy-user", password: "wrong" }))
      .status,
    401,
  );
});
test("five unique answers are enforced server-side and partial onboarding resumes", async () => {
  const cookie = await account("quiz-user");
  assert.equal(
    (
      await api("personal/answer", cookie, {
        version: 0,
        newsId: articles[0].id,
        interest: 5,
        importance: 5,
      })
    ).status,
    409,
  );
  const data = await complete(cookie);
  assert.equal(data.ready, true);
  assert.equal(data.question, null);
  assert.equal(data.profile.answers.length, 5);
  assert.equal(new Set(data.profile.answers.map((a) => a.newsId)).size, 5);
  assert.equal(data.profile.rules.topics["科研"], 1);
  assert.equal(
    (
      await api("personal/answer", cookie, {
        version: data.profile.version,
        newsId: articles[0].id,
        interest: 5,
        importance: 5,
      })
    ).status,
    409,
  );
  assert.deepEqual((await state(cookie)).profile, data.profile);
});
test("settings, language, feedback and undo share one versioned profile without cross-user changes", async () => {
  const a = await account("changes-a"),
    b = await account("changes-b");
  let data = await complete(a),
    other = await complete(b, "多看编程");
  const original = structuredClone(data.profile.rules),
    beforeB = structuredClone(other);
  const rules = structuredClone(original);
  rules.weights = { relevance: 80, importance: 10, freshness: 10 };
  let res = await api("personal/settings", a, {
    version: data.profile.version,
    rules,
  });
  assert.equal(res.status, 200);
  data = await res.json();
  res = await api("personal/language", a, {
    version: data.profile.version,
    text: "多看智能体",
  });
  data = await res.json();
  const news = data.personal.find((n) => n.topic === "智能体")!;
  res = await api("personal/feedback", a, {
    version: data.profile.version,
    newsId: news.id,
    topic: news.topic,
    direction: "more",
  });
  data = await res.json();
  assert.equal(data.profile.rules.topics["智能体"], 1.5);
  assert.equal(data.profile.rules.weights.relevance, 80);
  assert.equal(
    (await api("personal/language", a, { version: 0, text: "多看科研" }))
      .status,
    409,
  );
  for (let i = 0; i < 3; i++) {
    res = await api("personal/undo", a, { version: data.profile.version });
    assert.equal(res.status, 200);
    data = await res.json();
  }
  assert.deepEqual(data.profile.rules, original);
  other = await state(b);
  assert.deepEqual(other.profile, beforeB.profile);
  assert.deepEqual(other.history, beforeB.history);
  assert.notEqual(data.personal[0].id, other.personal[0].id);
});
test("explicit blocks survive calibration and feedback; ambiguous language causes no mutation", async () => {
  const cookie = await account("blocks-user");
  let data = await complete(cookie, "屏蔽公共治理");
  const before = structuredClone(data.profile);
  const n = data.publicNews[0];
  assert.equal(
    (
      await api("personal/feedback", cookie, {
        version: before.version,
        newsId: n.id,
        topic: n.topic,
        direction: "more",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api("personal/language", cookie, {
        version: before.version,
        text: "多看科研，少一点这种",
      })
    ).status,
    422,
  );
  assert.deepEqual((await state(cookie)).profile, before);
  const blocked = learn(before.rules, n, {
    newsId: n.id,
    interest: 5,
    importance: 5,
  });
  assert.equal(blocked.topics[n.topic], -2);
  const res = await api("personal/language", cookie, {
    version: before.version,
    text: "恢复公共治理默认",
  });
  data = await res.json();
  assert.equal(data.profile.rules.locks.includes(n.topic), false);
});
test("read state and collapse persist separately, do not train, and remain isolated", async () => {
  const a = await account("read-a"),
    b = await account("read-b");
  let data = await complete(a);
  await complete(b);
  const before = structuredClone(data.profile),
    n = data.publicNews[0];
  data = await (await api("personal/read", a, { newsId: n.id })).json();
  assert.deepEqual(data.profile, before);
  assert.ok(data.publicNews.find((x) => x.id === n.id)?.read);
  assert.ok(data.personal.find((x) => x.id === n.id)?.read);
  await api("personal/display", a, { collapsed: true });
  assert.equal((await state(a)).publicCollapsed, true);
  assert.equal((await state(b)).publicCollapsed, false);
  assert.equal(
    (await state(b)).publicNews.find((x) => x.id === n.id)?.read,
    false,
  );
  assert.equal(
    (
      await api("personal/language", a, {
        version: before.version,
        accountId: "another-user",
        text: "多看科研",
      })
    ).status,
    409,
  );
});
test("invalid weights, unsafe URLs, duplicate IDs and malformed ratings are rejected", async () => {
  assert.throws(() =>
    validateCatalog([{ ...articles[0], url: "javascript:alert(1)" }]),
  );
  assert.throws(() => validateCatalog([articles[0], articles[0]]));
  const cookie = await account("invalid-user"),
    data = await complete(cookie);
  const rules = structuredClone(data.profile.rules);
  rules.weights = { relevance: 0, importance: 0, freshness: 0 };
  assert.equal(
    (
      await api("personal/settings", cookie, {
        version: data.profile.version,
        rules,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("personal/language", cookie, {
        version: data.profile.version,
        text: "多看科研",
        useNeutral: true,
      })
    ).status,
    400,
  );
});
test("failed transactions roll back profile and history; undo cannot act on another account", () => {
  assert.throws(() =>
    mutate("transaction-user", 0, (p) => {
      p.rules.topics["科研"] = 2;
      throw new Error("failure");
    }),
  );
  assert.equal(getProfile("transaction-user").version, 0);
  assert.equal(view("transaction-user", articles, "").history.length, 0);
  assert.throws(() => undo("transaction-user", 0), Conflict);
  assert.equal(
    db
      .prepare("SELECT count(*) AS n FROM personal_profiles WHERE userId=?")
      .get("transaction-user")?.n,
    0,
  );
});

test("audit accounts for every exclusion and contribution; public news bypasses personal blocks only", () => {
  const p = initialProfile();
  p.rules.locks = ["公共治理"];
  p.rules.topics["公共治理"] = -2;
  p.rules.sources[articles[0].source] = -2;
  const news = [...articles, { ...articles[2], id: "old", date: "2026-10-01" }];
  const result = rankWithAudit(
    p,
    news,
    new Set(),
    Date.parse("2026-10-09T12:00:00Z"),
    { start: "2026-10-09", end: "2026-10-09" },
  );
  assert.equal(
    result.audit.stages.reduce((sum, s) => sum + s.removed, 0) +
      result.personal.length,
    news.length,
  );
  assert.equal(
    result.audit.excluded.length + result.personal.length,
    news.length,
  );
  assert.match(
    result.audit.excluded.find((n) => n.id === "old")!.reason,
    /时间/,
  );
  assert.match(
    result.audit.excluded.find((n) => n.id === "unverified")!.reason,
    /证据/,
  );
  assert.ok(result.audit.excluded.filter((n) => n.public).length === 2);
  for (const n of result.personal) {
    assert.ok(
      Math.abs(
        n.breakdown!.reduce((sum, x) => sum + x.contribution, 0) - n.score,
      ) < 1e-10,
    );
    assert.ok(
      Math.abs(n.breakdown!.reduce((sum, x) => sum + x.weight, 0) - 100) <
        1e-10,
    );
  }
});

test("optional diversity reranking diversifies top positions, is deterministic, and keeps exclusions", () => {
  const p = initialProfile();
  p.rules.weights = { relevance: 100, importance: 0, freshness: 0 };
  p.rules.topics["模型与编程"] = 1;
  const news = [articles[0], articles[1], { ...articles[2], importance: 3 }];
  const original = rank(p, news, new Set(), 0);
  assert.equal(original.personal[1].topic, "模型与编程");
  p.rules.diversity = 30;
  const diverse = rank(p, news, new Set(), 0);
  assert.equal(diverse.personal[1].topic, "智能体");
  assert.equal(diverse.personal[2].ranking!.penalty, 30);
  assert.equal(diverse.personal[2].ranking!.similarTo, articles[0].title);
  assert.deepEqual(rank(p, news, new Set(), 0), diverse);
  p.rules.locks = ["智能体"];
  assert.equal(rank(p, news, new Set(), 0).personal.length, 2);
  p.rules.diversity = 0;
  p.rules.locks = [];
  assert.deepEqual(rank(p, news, new Set(), 0), original);
  const crowded = Array.from({ length: 25 }, (_, i) => ({
    ...articles[0],
    id: `cap-${i}`,
  }));
  const capped = rankWithAudit(p, crowded, new Set(), 0);
  assert.equal(capped.personal.length, 20);
  assert.equal(capped.audit.excluded.length, 5);
  assert.ok(capped.audit.excluded.every((n) => /前20条/.test(n.reason)));
});

test("preview is authenticated, versioned, period-aware and does not mutate profiles, reads or history", async () => {
  const cookie = await account("preview-user");
  const data = await complete(cookie);
  const rules = structuredClone(data.profile.rules);
  rules.diversity = 20;
  rules.topics["公共治理"] = -2; // stale locks normalized just as settings save does
  const response = await api("personal/preview", cookie, {
    version: data.profile.version,
    rules,
  });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.ok(preview.after.every((n: News) => n.topic !== "公共治理"));
  assert.equal(preview.audit.publicCount, 2);
  const empty = await (
    await api("personal/preview?start=2026-10-01&end=2026-10-01", cookie, {
      version: data.profile.version,
      rules,
    })
  ).json();
  assert.equal(empty.before.length, 0);
  assert.equal(empty.after.length, 0);
  assert.equal(empty.audit.stages[1].count, 0);
  const after = await state(cookie);
  assert.deepEqual(after.profile, data.profile);
  assert.deepEqual(after.history, data.history);
  assert.ok(after.personal.every((n) => !n.read));
  assert.equal(
    (await api("personal/preview", "", { version: 0, rules })).status,
    401,
  );
  assert.equal(
    (await api("personal/preview", cookie, { version: 0, rules })).status,
    409,
  );
  assert.equal(
    (
      await api("personal/preview", cookie, {
        version: data.profile.version,
        rules: { ...rules, diversity: 31 },
      })
    ).status,
    400,
  );
});

test("portable rules exclude profile data, validate versions, preserve dormant sources and undo", async () => {
  const p = initialProfile();
  p.description = "private description";
  p.rules.diversity = 15;
  p.rules.sources["future.example"] = -2;
  const exported = exportRecipe({
    ...p.rules,
    description: p.description,
  } as typeof p.rules);
  assert.deepEqual(Object.keys(exported).sort(), [
    "engine",
    "format",
    "rules",
    "version",
  ]);
  assert.ok(!JSON.stringify(exported).includes("private description"));
  const parsed = importRecipe(JSON.stringify(exported));
  assert.deepEqual(parsed, p.rules);
  assert.throws(() =>
    importRecipe(JSON.stringify({ ...exported, version: 999 })),
  );
  assert.throws(() =>
    importRecipe(
      JSON.stringify({
        ...exported,
        rules: {
          ...p.rules,
          weights: { relevance: 0, importance: 0, freshness: 0 },
        },
      }),
    ),
  );
  assert.throws(() => importRecipe("x".repeat(100001)));
  const cookie = await account("recipe-user");
  const before = await complete(cookie);
  const response = await api("personal/settings", cookie, {
    version: before.profile.version,
    rules: parsed,
  });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.profile.rules.sources["future.example"], -2);
  assert.match(saved.history[0].message, /内容多样性/);
  await api("personal/undo", cookie, { version: saved.profile.version });
  assert.deepEqual((await state(cookie)).profile.rules, before.profile.rules);
});
