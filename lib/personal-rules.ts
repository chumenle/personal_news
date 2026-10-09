import { z } from "zod";
import { topics, type Rules } from "./personal-types";

export const engineVersion = "transparent-diversity-v1";
const preference = z.number().min(-2).max(2).multipleOf(0.1);
const topicScores = z.preprocess(
  (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? { 娱乐: 0, ...value }
      : value,
  z.record(z.enum(topics), preference),
);
export const rulesSchema = z.object({
  diversity: z.number().int().min(0).max(30).optional(),
  topics: topicScores,
  importance: topicScores,
  locks: z.array(z.enum(topics)).max(topics.length),
  sources: z
    .record(z.string().min(1).max(200), preference)
    .refine((v) => Object.keys(v).length <= 300, "来源设置最多300项"),
  weights: z
    .object({
      relevance: z.number().int().min(0).max(100),
      importance: z.number().int().min(0).max(100),
      freshness: z.number().int().min(0).max(100),
    })
    .refine(
      (w) => w.relevance + w.importance + w.freshness > 0,
      "至少保留一项排序权重",
    ),
});
export function normalizeRules(rules: Rules): Rules {
  return {
    ...upgradeRules(rules),
    locks: topics.filter((t) => rules.topics[t] === -2),
  };
}
// Older saved profiles, undo snapshots and shared recipes predate this topic.
export function upgradeRules(rules: Rules): Rules {
  return {
    ...rules,
    topics: { ...rules.topics, 娱乐: rules.topics.娱乐 ?? 0 },
    importance: { ...rules.importance, 娱乐: rules.importance.娱乐 ?? 0 },
  };
}
const recipeSchema = z.object({
  format: z.literal("personal-news-rules"),
  version: z.literal(1),
  engine: z.literal(engineVersion),
  rules: rulesSchema,
});
export function exportRecipe(rules: Rules) {
  // Whitelist the schema; never serialize a profile or its behavioral records.
  return {
    format: "personal-news-rules",
    version: 1,
    engine: engineVersion,
    rules: normalizeRules(rulesSchema.parse(rules)),
  };
}
export function importRecipe(text: string): Rules {
  if (text.length > 100000)
    throw new Error("规则文件过大，请选择100KB以内的文件。");
  const result = recipeSchema.safeParse(JSON.parse(text));
  if (!result.success)
    throw new Error("规则文件格式、版本或参数无效，未修改设置。");
  return normalizeRules(result.data.rules);
}
