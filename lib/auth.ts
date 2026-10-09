import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "./store";
export const cookieName = "personal_news_session";
export const ownerId = "legacy-owner";
db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS account_throttle (username TEXT PRIMARY KEY, failures INTEGER NOT NULL, until INTEGER NOT NULL);`);
if (
  !db
    .prepare("PRAGMA table_info(sessions)")
    .all()
    .some((c) => c.name === "userId")
) {
  db.exec(
    "ALTER TABLE sessions ADD COLUMN userId TEXT NOT NULL DEFAULT 'legacy-owner'",
  );
}
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function currentUser(
  req: NextRequest,
): { id: string; username: string; owner: boolean } | null {
  const token = req.cookies.get(cookieName)?.value;
  const session =
    token &&
    db
      .prepare("SELECT userId FROM sessions WHERE token=? AND expires>?")
      .get(digest(token), Date.now());
  if (!session) return null;
  const id = String(session.userId);
  if (id === ownerId)
    return { id, username: process.env.NEWS_USERNAME || "owner", owner: true };
  const user = db.prepare("SELECT username FROM users WHERE id=?").get(id);
  return user ? { id, username: String(user.username), owner: false } : null;
}
export function authenticated(req: NextRequest) {
  return !!currentUser(req);
}
function sessionFor(userId: string) {
  db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token,expires,userId) VALUES (?,?,?)").run(
    digest(token),
    Date.now() + 30 * 86400000,
    userId,
  );
  return token;
}
export function register(username: string, password: string) {
  if (
    username === (process.env.NEWS_USERNAME || "owner") ||
    db.prepare("SELECT 1 FROM users WHERE username=?").get(username)
  )
    throw new Error("用户名已被使用，请换一个。");
  const salt = randomBytes(16).toString("hex"),
    id = randomUUID();
  const hash = salt + ":" + scryptSync(password, salt, 64).toString("hex");
  db.prepare("INSERT INTO users VALUES (?,?,?)").run(id, username, hash);
  return sessionFor(id);
}
export function login(username: string, password: string) {
  const throttle = db
    .prepare("SELECT * FROM account_throttle WHERE username=?")
    .get(username);
  if (throttle && Number(throttle.until) > Date.now())
    throw new Error("尝试次数过多，请 15 分钟后再试。");
  const isOwner = username === (process.env.NEWS_USERNAME || "owner");
  const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  const [salt, expected] = String(
    isOwner ? process.env.NEWS_PASSWORD_HASH || "" : user?.passwordHash || "",
  ).split(":");
  const validHash = !!salt && /^[a-f0-9]{128}$/i.test(expected || "");
  const actual = scryptSync(password, validHash ? salt : "unknown-account", 64);
  if (!validHash || !timingSafeEqual(actual, Buffer.from(expected, "hex"))) {
    const failures =
      throttle && Number(throttle.until) > 0
        ? 1
        : Number(throttle?.failures || 0) + 1;
    db.prepare("INSERT OR REPLACE INTO account_throttle VALUES (?,?,?)").run(
      username,
      failures,
      failures >= 10 ? Date.now() + 900000 : 0,
    );
    return null;
  }
  db.prepare("DELETE FROM account_throttle WHERE username=?").run(username);
  return sessionFor(isOwner ? ownerId : String(user!.id));
}
export function logout(req: NextRequest) {
  const token = req.cookies.get(cookieName)?.value;
  if (token)
    db.prepare("DELETE FROM sessions WHERE token=?").run(digest(token));
}
