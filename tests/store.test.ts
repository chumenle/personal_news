import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { randomUUID } from "node:crypto";
mkdirSync("test-results", { recursive: true });
process.env.NEWS_DATA_DIR = mkdtempSync("test-results/store-");
const {
  db,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  annotations,
  Conflict,
} = await import("../lib/store");
const editionId = randomUUID();
db.prepare("INSERT INTO editions VALUES (?,?,?,?,?,?)").run(
  editionId,
  "测试报刊",
  "2026-10-09",
  "test-hash",
  "[[0,0,595,842]]",
  new Date().toISOString(),
);
const input = () => ({
  id: randomUUID(),
  editionId,
  page: 1,
  rects: [[12, 12, 100, 30] as [number, number, number, number]],
  kind: "highlight" as const,
  color: "yellow" as const,
  quote: "值得再读一次的句子",
  note: "",
});
test("lost-response create retries are idempotent", () => {
  const a = input();
  const first = createAnnotation(a),
    second = createAnnotation(a);
  assert.equal(first.id, second.id);
  assert.equal(first.version, second.version);
  assert.equal(annotations().filter((row) => row.id === a.id).length, 1);
  assert.throws(() => createAnnotation({ ...a, note: "changed" }), Conflict);
});
test("two devices cannot overwrite a stale version", () => {
  const a = createAnnotation(input());
  const saved = updateAnnotation(a.id, a.version, {
    kind: "underline",
    color: "blue",
    note: "设备 A 的想法",
  });
  assert.equal(saved.version, 2);
  assert.throws(
    () =>
      updateAnnotation(a.id, a.version, {
        kind: "note",
        color: "pink",
        note: "设备 B 的旧副本",
      }),
    Conflict,
  );
  assert.equal(
    annotations().find((row) => row.id === a.id)?.note,
    "设备 A 的想法",
  );
});
test("deletion keeps a tombstone; stale edits cannot resurrect it", () => {
  const a = createAnnotation(input());
  deleteAnnotation(a.id, 1);
  deleteAnnotation(a.id, 1);
  assert.equal(
    annotations().some((row) => row.id === a.id),
    false,
  );
  assert.throws(
    () =>
      updateAnnotation(a.id, 1, {
        kind: "note",
        color: "yellow",
        note: "stale",
      }),
    Conflict,
  );
  assert.throws(() => createAnnotation({ ...a }), Conflict);
});
test("stale delete cannot remove a newer note", () => {
  const a = createAnnotation(input());
  updateAnnotation(a.id, 1, { kind: "note", color: "green", note: "new" });
  assert.throws(() => deleteAnnotation(a.id, 1), Conflict);
  assert.equal(annotations().find((row) => row.id === a.id)?.note, "new");
});
test("coordinates and unicode round-trip without loss", () => {
  const a = createAnnotation({
    ...input(),
    rects: [[12.333, 21.456, 121.666, 38.123]],
    quote: "中文、多栏与 emoji 🌿",
    note: "第一行\n第二行",
  });
  assert.deepEqual(
    annotations().find((row) => row.id === a.id)?.rects,
    a.rects,
  );
  assert.equal(annotations().find((row) => row.id === a.id)?.note, a.note);
});
