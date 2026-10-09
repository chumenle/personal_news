import {
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
try {
  process.loadEnvFile(".env.local");
} catch {}
async function main() {
  const { validateCatalog } = await import("../lib/news-catalog");
  const { dataDir } = await import("../lib/store");
  if (!process.argv[2])
    throw new Error("用法：npm run import:news -- 选题文件.json");
  const news = validateCatalog(
    JSON.parse(readFileSync(path.resolve(process.argv[2]), "utf8")),
  );
  const target = path.join(dataDir, "news-catalog.json");
  if (existsSync(target))
    copyFileSync(target, target + ".backup-" + Date.now());
  const pending = target + ".pending-" + process.pid;
  writeFileSync(pending, JSON.stringify(news, null, 2));
  renameSync(pending, target);
  console.log(`已导入 ${news.length} 条选题；证据不合格的条目将被过滤。`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
