import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
try {
  process.loadEnvFile(".env.local");
} catch {}
const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
if (!existsSync(path.join(standalone, "server.js")))
  throw new Error("请先运行 npm run build。");
process.env.NEWS_DATA_DIR = path.resolve(process.env.NEWS_DATA_DIR || "./data");
process.env.HOSTNAME ||= "127.0.0.1";
process.env.PORT ||= "3000";
cpSync(path.join(root, "public"), path.join(standalone, "public"), {
  recursive: true,
});
cpSync(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static"),
  { recursive: true },
);
await import(pathToFileURL(path.join(standalone, "server.js")).href);
