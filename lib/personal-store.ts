import { randomUUID } from "node:crypto";
import { db, Conflict } from "./store";
import { initialProfile, nextQuestion, rankWithAudit } from "./personal-engine";
import type { Profile, Rules, News, PersonalView } from "./personal-types";
import { type NewsPeriod } from "./news-period";
import { upgradeRules } from "./personal-rules";

db.exec(`CREATE TABLE IF NOT EXISTS personal_profiles (userId TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS personal_changes (
 id TEXT PRIMARY KEY, userId TEXT NOT NULL, beforeRules TEXT NOT NULL, afterRules TEXT NOT NULL,
 message TEXT NOT NULL, at TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0, undoable INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS personal_changes_user ON personal_changes(userId);
 CREATE TABLE IF NOT EXISTS personal_reads (userId TEXT NOT NULL, newsId TEXT NOT NULL, PRIMARY KEY(userId,newsId));
 CREATE TABLE IF NOT EXISTS personal_display (userId TEXT PRIMARY KEY, collapsed INTEGER NOT NULL);`);

export function getProfile(userId: string): Profile {
  const row = db
    .prepare("SELECT value FROM personal_profiles WHERE userId=?")
    .get(userId);
  if (!row) return initialProfile();
  const profile: Profile = JSON.parse(String(row.value));
  return { ...profile, rules: upgradeRules(profile.rules) };
}
export function mutate(
  userId: string,
  version: number,
  update: (p: Profile) => { message: string; undoable?: boolean },
): Profile {
  db.exec("BEGIN IMMEDIATE");
  try {
    const p = getProfile(userId);
    if (p.version !== version)
      throw new Conflict("规则已在其他页面更新，请刷新后重试；输入仍保留。");
    const before = JSON.stringify(p.rules);
    const { message, undoable = p.answers.length >= 5 } = update(p);
    p.version++;
    db.prepare("INSERT OR REPLACE INTO personal_profiles VALUES (?,?)").run(
      userId,
      JSON.stringify(p),
    );
    db.prepare(
      "INSERT INTO personal_changes (id,userId,beforeRules,afterRules,message,at,undoable) VALUES (?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      userId,
      before,
      JSON.stringify(p.rules),
      message,
      new Date().toISOString(),
      Number(undoable),
    );
    db.exec("COMMIT");
    return p;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function undo(userId: string, version: number) {
  return mutate(userId, version, (p) => {
    const last = db
      .prepare(
        "SELECT * FROM personal_changes WHERE userId=? AND undone=0 AND undoable=1 ORDER BY rowid DESC LIMIT 1",
      )
      .get(userId);
    if (!last) throw new Conflict("没有可撤销的规则调整。");
    if (
      JSON.stringify(p.rules) !==
      JSON.stringify(upgradeRules(JSON.parse(String(last.afterRules))))
    )
      throw new Conflict("规则已变化，请刷新后检查。");
    p.rules = upgradeRules(JSON.parse(String(last.beforeRules)) as Rules);
    db.prepare(
      "UPDATE personal_changes SET undone=1 WHERE id=? AND userId=?",
    ).run(String(last.id), userId);
    return { message: "已撤销：" + String(last.message), undoable: false };
  });
}
export function view(
  userId: string,
  news: News[],
  note: string,
  period: NewsPeriod | null = null,
): PersonalView {
  const profile = getProfile(userId),
    ready = profile.answers.length >= 5;
  const reads = new Set(
    db
      .prepare("SELECT newsId FROM personal_reads WHERE userId=?")
      .all(userId)
      .map((r) => String(r.newsId)),
  );
  // Filter before ranking and the 20-item cap; calibration still uses the full catalog.
  const feed = ready
    ? rankWithAudit(profile, news, reads, Date.now(), period)
    : { personal: [], publicNews: [], audit: null };
  return {
    profile,
    ready,
    ...feed,
    question: nextQuestion(profile, news),
    sources: [...new Set(news.map((n) => n.source))].sort(),
    catalogNote: note,
    publicCollapsed: !!db
      .prepare("SELECT collapsed FROM personal_display WHERE userId=?")
      .get(userId)?.collapsed,
    history: db
      .prepare(
        "SELECT id,message,at,undone,undoable FROM personal_changes WHERE userId=? ORDER BY rowid DESC LIMIT 100",
      )
      .all(userId)
      .map((r) => ({
        id: String(r.id),
        message: String(r.message),
        at: String(r.at),
        undone: !!r.undone,
        undoable: !!r.undoable,
      })),
  };
}
