import { mkdirSync, cpSync, existsSync } from "node:fs";
import path from "node:path";
import { backup } from "node:sqlite";
try {
  process.loadEnvFile(".env.local");
} catch {}
async function main() {
  const { db, dataDir } = await import("../lib/store");
  const target = path.resolve(
    "backups",
    new Date().toISOString().replaceAll(":", "-"),
  );
  mkdirSync(target, { recursive: true });
  await backup(db, path.join(target, "news.sqlite"));
  const catalog = path.join(dataDir, "news-catalog.json");
  if (existsSync(catalog))
    cpSync(catalog, path.join(target, "news-catalog.json"));
  cpSync(path.join(dataDir, "pdfs"), path.join(target, "pdfs"), {
    recursive: true,
  });
  console.log(`备份完成：${target}。请另外安全保存账号配置。`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
