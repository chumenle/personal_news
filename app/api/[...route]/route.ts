import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { currentUser, cookieName, login, logout, register } from "@/lib/auth";
import { personalApi } from "@/lib/personal-api";
import { isAllowedOrigin } from "@/lib/request-origin";
import {
  db,
  dataDir,
  editions,
  edition,
  annotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  Conflict,
} from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const mutable = z.object({
  kind: z.enum(["highlight", "underline", "note"]),
  color: z.enum(["yellow", "green", "blue", "pink"]),
  note: z.string().max(10000),
});
const creation = mutable.extend({
  id: z.string().uuid(),
  editionId: z.string().uuid(),
  page: z.number().int().min(1),
  quote: z.string().min(1).max(20000),
  rects: z
    .array(
      z.tuple([
        z.number().finite(),
        z.number().finite(),
        z.number().finite(),
        z.number().finite(),
      ]),
    )
    .min(1)
    .max(500),
});
async function body(req: NextRequest) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("请求必须使用 JSON。");
  const raw = await req.text();
  if (raw.length > 128000) throw new Error("请求内容过长。");
  return JSON.parse(raw);
}
async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ route: string[] }> },
) {
  try {
    const parts = (await ctx.params).route;
    const name = parts.join("/");
    if (req.method !== "GET") {
      if (!isAllowedOrigin(req))
        return json({ error: "请求来源不匹配。" }, 403);
    }
    if (name === "register" && req.method === "POST") {
      const input = z
        .object({
          username: z
            .string()
            .trim()
            .min(3)
            .max(40)
            .regex(/^[\p{L}\p{N}_-]+$/u),
          password: z.string().min(10).max(128),
        })
        .parse(await body(req));
      const token = register(input.username, input.password);
      const response = json({ ok: true }, 201);
      response.cookies.set(cookieName, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NEWS_SECURE_COOKIE === "true",
        path: "/",
        maxAge: 30 * 86400,
      });
      return response;
    }
    if (name === "login" && req.method === "POST") {
      const input = z
        .object({
          username: z.string().max(100),
          password: z.string().max(1024),
        })
        .parse(await body(req));
      const token = login(input.username, input.password);
      if (!token) return json({ error: "用户名或密码不正确。" }, 401);
      const response = json({ ok: true });
      response.cookies.set(cookieName, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NEWS_SECURE_COOKIE === "true",
        path: "/",
        maxAge: 30 * 86400,
      });
      return response;
    }
    const user = currentUser(req);
    if (!user) return json({ error: "请先登录。" }, 401);
    if (name === "session" && req.method === "GET") return json(user);
    if (name === "logout" && req.method === "POST") {
      logout(req);
      const response = json({ ok: true });
      response.cookies.delete(cookieName);
      return response;
    }
    if (parts[0] === "personal" && parts.length <= 2)
      return personalApi(
        user.id,
        req.method,
        parts[1] || "",
        req.method === "GET" ? undefined : await body(req),
        req.nextUrl.searchParams,
      );
    // Existing editions and annotations belong to the original private account.
    if (!user.owner)
      return json(
        { error: "这是原有账号的私人阅报室，请前往“我的新闻”。" },
        403,
      );
    if (name === "editions" && req.method === "GET") return json(editions());
    if (parts[0] === "pdf" && parts.length === 2 && req.method === "GET") {
      const item = edition(parts[1]);
      if (!item) return json({ error: "报刊不存在。" }, 404);
      const file = await readFile(
        path.join(dataDir, "pdfs", item.hash + ".pdf"),
      );
      return new NextResponse(file, {
        headers: {
          "Content-Type": "application/pdf",
          "Cache-Control": "private, no-store",
          "Content-Disposition": "inline",
        },
      });
    }
    if (name === "annotations" && req.method === "GET") {
      let rows = annotations(
        req.nextUrl.searchParams.get("editionId") || undefined,
      );
      const query = req.nextUrl.searchParams.get("q")?.toLocaleLowerCase();
      if (query)
        rows = rows.filter((a) =>
          (a.quote + "\n" + a.note).toLocaleLowerCase().includes(query),
        );
      return json(rows);
    }
    if (name === "annotations" && req.method === "POST") {
      const input = creation.parse(await body(req));
      const item = edition(input.editionId),
        bounds = item?.pages[input.page - 1];
      if (
        !bounds ||
        input.rects.some(
          ([x1, y1, x2, y2]) =>
            x2 <= x1 ||
            y2 <= y1 ||
            x1 < bounds[0] - 1 ||
            y1 < bounds[1] - 1 ||
            x2 > bounds[2] + 1 ||
            y2 > bounds[3] + 1,
        )
      )
        return json({ error: "标注位置超出报刊页面。" }, 400);
      return json(createAnnotation(input), 201);
    }
    if (
      parts[0] === "annotations" &&
      parts.length === 2 &&
      req.method === "PATCH"
    ) {
      const input = mutable
        .extend({ version: z.number().int().min(1) })
        .parse(await body(req));
      return json(updateAnnotation(parts[1], input.version, input));
    }
    if (
      parts[0] === "annotations" &&
      parts.length === 2 &&
      req.method === "DELETE"
    ) {
      const input = z
        .object({ version: z.number().int().min(1) })
        .parse(await body(req));
      deleteAnnotation(parts[1], input.version);
      return json({ ok: true });
    }
    if (parts[0] === "progress" && parts.length === 2) {
      const item = edition(parts[1]);
      if (!item) return json({ error: "报刊不存在。" }, 404);
      if (req.method === "GET")
        return json(
          db
            .prepare("SELECT * FROM progress WHERE editionId=?")
            .get(item.id) || { page: 1, fraction: 0 },
        );
      if (req.method === "POST") {
        const input = z
          .object({
            page: z.number().int().min(1).max(item.pages.length),
            fraction: z.number().min(0).max(1),
          })
          .parse(await body(req));
        db.prepare("INSERT OR REPLACE INTO progress VALUES (?,?,?,?)").run(
          item.id,
          input.page,
          input.fraction,
          new Date().toISOString(),
        );
        return json({ ok: true });
      }
    }
    return json({ error: "接口不存在。" }, 404);
  } catch (error) {
    if (error instanceof Conflict) return json({ error: error.message }, 409);
    if (error instanceof z.ZodError)
      return json({ error: "输入内容或标注格式不正确。" }, 400);
    if (error instanceof SyntaxError)
      return json({ error: "请求格式不正确。" }, 400);
    console.error(error instanceof Error ? error.message : "API error");
    return json(
      {
        error:
          error instanceof Error && /请|请求/.test(error.message)
            ? error.message
            : "保存或读取失败，请保留草稿后重试。",
      },
      500,
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
