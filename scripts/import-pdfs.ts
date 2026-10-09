import { readdirSync, readFileSync, copyFileSync, constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
try {
  process.loadEnvFile(".env.local");
} catch {}
async function main() {
  const { db, dataDir } = await import("../lib/store");
  const source = path.resolve(process.argv[2] || "output/pdf");
  const files = source.toLowerCase().endsWith(".pdf")
    ? [source]
    : readdirSync(source)
        .filter((n) => n.toLowerCase().endsWith(".pdf"))
        .map((n) => path.join(source, n));
  let added = 0;
  for (const file of files) {
    const bytes = readFileSync(file),
      hash = createHash("sha256").update(bytes).digest("hex");
    const title = path.basename(file, ".pdf").replaceAll("_", " ");
    const dates = title.match(/\d{4}-\d{2}-\d{2}/g);
    let date =
      dates?.at(-1) ||
      new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    const shortEnd = title.match(/至(\d{2}-\d{2})(?!\d)/)?.[1];
    if (shortEnd && dates?.length) {
      let year = Number(dates[0].slice(0, 4));
      if (`${year}-${shortEnd}` < dates[0]) year++;
      date = `${year}-${shortEnd}`;
    }
    if (db.prepare("SELECT 1 FROM editions WHERE hash=?").get(hash)) {
      // Metadata can be corrected without changing the immutable PDF/version ID.
      db.prepare("UPDATE editions SET date=? WHERE hash=?").run(date, hash);
      continue;
    }
    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPages().map((page) => {
      const b = page.getCropBox();
      return [b.x, b.y, b.x + b.width, b.y + b.height];
    });
    const target = path.join(dataDir, "pdfs", hash + ".pdf");
    try {
      copyFileSync(file, target, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    db.prepare("INSERT INTO editions VALUES (?,?,?,?,?,?)").run(
      randomUUID(),
      title,
      date,
      hash,
      JSON.stringify(pages),
      new Date().toISOString(),
    );
    added++;
    console.log(`已导入：${title}（${pages.length} 页）`);
  }
  console.log(`新增 ${added} 期；相同内容自动跳过，旧版本保持不变。`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
