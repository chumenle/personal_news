import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dataDir } from "./store";
import { topics, type News, type Topic } from "./personal-types";
import legacyNews from "./seed-news.json";

const level = z.number().min(0).max(5);
export const newsSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  summary: z.string().max(3000),
  topic: z.enum(topics),
  source: z.string().min(1).max(200),
  url: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//.test(v)),
  date: z.iso.date(),
  evidence: z.object({
    approved: z.boolean(),
    note: z.string().min(1).max(2000),
  }),
  importance: level,
  publicAssessment: z
    .object({
      reach: level,
      severity: level,
      urgency: level,
      reason: z.string().min(1).max(2000),
    })
    .optional(),
});
export function validateCatalog(value: unknown): News[] {
  const news = z.array(newsSchema).max(10000).parse(value);
  if (new Set(news.map((n) => n.id)).size !== news.length)
    throw new Error("新闻编号重复。");
  return news;
}
export function catalog(): { news: News[]; note: string } {
  const custom = path.join(dataDir, "news-catalog.json");
  if (existsSync(custom))
    return {
      news: validateCatalog(JSON.parse(readFileSync(custom, "utf8"))),
      note: "使用已导入的编辑选题库；来源与证据状态由选题库提供。",
    };
  const legacy = legacyNews;
  const categories: Topic[] = [
    "公共治理",
    "产业商业",
    "模型与编程",
    "智能体",
    "芯片与基础设施",
    "智能体",
    "模型与编程",
    "科研",
    "模型与编程",
    "科研",
    "创作工具",
    "科研",
    "创作工具",
    "模型与编程",
    "公共治理",
    "产业商业",
  ];
  return {
    note: "历史选题体验 · 2026-09-27 至 10-06。沿用当时的编辑审查记录，未实时复核；未记录公共影响三项评估的新闻不进入公共重要区。",
    news: legacy
      .filter((n) => n.source && n.ratings)
      .map((n, i) => ({
        id: `archive-20261006-${i + 1}`,
        title: n.topic,
        summary: n.reason,
        topic: categories[i],
        source: new URL(n.source).hostname,
        url: n.source,
        date: "2026-10-06",
        evidence: {
          approved: n.evidence.startsWith("通过："),
          note: n.evidence,
        },
        importance: n.ratings![0],
      })),
  };
}
