import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Annotation, Edition } from "./types";

export const dataDir = path.resolve(
  /* turbopackIgnore: true */ process.env.NEWS_DATA_DIR || "./data",
);
mkdirSync(path.join(dataDir, "pdfs"), { recursive: true });
const globalDb = globalThis as typeof globalThis & { newsDb?: DatabaseSync };
export const db = (globalDb.newsDb ||= new DatabaseSync(
  path.join(dataDir, "news.sqlite"),
));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS editions (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
 pages TEXT NOT NULL, createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS annotations (
 id TEXT PRIMARY KEY, editionId TEXT NOT NULL REFERENCES editions(id), page INTEGER NOT NULL,
 rects TEXT NOT NULL, kind TEXT NOT NULL, color TEXT NOT NULL, quote TEXT NOT NULL, note TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, updatedAt TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS annotations_edition ON annotations(editionId, deleted);
 CREATE TABLE IF NOT EXISTS progress (editionId TEXT PRIMARY KEY REFERENCES editions(id), page INTEGER NOT NULL, fraction REAL NOT NULL, updatedAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS login_throttle (id INTEGER PRIMARY KEY CHECK(id=1), failures INTEGER NOT NULL, until INTEGER NOT NULL);
 PRAGMA user_version=1;`);

export function editions(): Edition[] {
  return db
    .prepare("SELECT * FROM editions ORDER BY date DESC, createdAt DESC, title")
    .all()
    .map((row) => ({
      ...row,
      pages: JSON.parse(row.pages as string),
    })) as Edition[];
}
export function edition(id: string): Edition | undefined {
  return editions().find((e) => e.id === id);
}
function decode(row: Record<string, unknown>): Annotation {
  return { ...row, rects: JSON.parse(row.rects as string) } as Annotation;
}
export function annotations(editionId?: string): Annotation[] {
  const rows = editionId
    ? db
        .prepare(
          "SELECT * FROM annotations WHERE deleted=0 AND editionId=? ORDER BY page, updatedAt DESC",
        )
        .all(editionId)
    : db
        .prepare(
          "SELECT * FROM annotations WHERE deleted=0 ORDER BY updatedAt DESC",
        )
        .all();
  return rows.map(decode);
}
export class Conflict extends Error {}
export function createAnnotation(
  a: Omit<Annotation, "version" | "updatedAt">,
): Annotation {
  const old = db.prepare("SELECT * FROM annotations WHERE id=?").get(a.id);
  if (old) {
    if (
      !old.deleted &&
      ["editionId", "page", "kind", "color", "quote", "note"].every(
        (k) => old[k] === a[k as keyof typeof a],
      ) &&
      old.rects === JSON.stringify(a.rects)
    )
      return decode(old);
    throw new Conflict("同一标注已保存或已被修改，请刷新后检查。");
  }
  const updatedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO annotations (id,editionId,page,rects,kind,color,quote,note,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    a.id,
    a.editionId,
    a.page,
    JSON.stringify(a.rects),
    a.kind,
    a.color,
    a.quote,
    a.note,
    updatedAt,
  );
  return { ...a, version: 1, updatedAt };
}
export function updateAnnotation(
  id: string,
  version: number,
  values: { kind: string; color: string; note: string },
): Annotation {
  const updatedAt = new Date().toISOString();
  const result = db
    .prepare(
      "UPDATE annotations SET kind=?,color=?,note=?,version=version+1,updatedAt=? WHERE id=? AND version=? AND deleted=0",
    )
    .run(values.kind, values.color, values.note, updatedAt, id, version);
  if (!result.changes)
    throw new Conflict(
      "这条笔记已在另一设备修改或删除。你的草稿已保留，请查看最新版本后再决定。",
    );
  return decode(db.prepare("SELECT * FROM annotations WHERE id=?").get(id)!);
}
export function deleteAnnotation(id: string, version: number) {
  const old = db.prepare("SELECT * FROM annotations WHERE id=?").get(id);
  if (old?.deleted) return;
  const result = db
    .prepare(
      "UPDATE annotations SET deleted=1,version=version+1,updatedAt=? WHERE id=? AND version=? AND deleted=0",
    )
    .run(new Date().toISOString(), id, version);
  if (!result.changes)
    throw new Conflict("笔记已发生变化，请查看最新版本后再删除。");
}
