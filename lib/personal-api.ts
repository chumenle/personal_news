import { z } from "zod";
import { NextResponse } from "next/server";
import { db, Conflict } from "./store";
import { topics, type Rules } from "./personal-types";
import { catalog } from "./news-catalog";
import {
  adjustPreference,
  applyInterpretation,
  eligible,
  interpret,
  learn,
  nextQuestion,
  rankWithAudit,
} from "./personal-engine";
import { rulesSchema, normalizeRules } from "./personal-rules";
import { getProfile, mutate, undo, view } from "./personal-store";
import { parsePeriod } from "./news-period";

const versioned = z.object({ version: z.number().int().min(0) });
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function personalApi(
  userId: string,
  method: string,
  action: string,
  input?: unknown,
  params = new URLSearchParams(),
) {
  let period;
  try {
    period = parsePeriod(params);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "时间区间无效。" },
      400,
    );
  }
  const { news, note } = catalog();
  if (method === "GET" && !action)
    return json(view(userId, news, note, period));
  if (method !== "POST") return json({ error: "接口不存在。" }, 404);
  const account = z.object({ accountId: z.string().optional() }).parse(input);
  if (account.accountId && account.accountId !== userId)
    return json({ error: "登录账号已变化，请刷新页面后再操作。" }, 409);
  if (action === "preview") {
    const { version, rules } = versioned
      .extend({ rules: rulesSchema })
      .parse(input);
    const profile = getProfile(userId);
    if (profile.version !== version)
      throw new Conflict("规则已更新，请刷新后重新预览。");
    if (profile.answers.length < 5) throw new Conflict("请先完成5道偏好题。");
    const now = Date.now();
    const before = rankWithAudit(profile, news, new Set(), now, period);
    const after = rankWithAudit(
      { ...profile, rules: normalizeRules(rules) },
      news,
      new Set(),
      now,
      period,
    );
    return json({
      before: before.personal,
      after: after.personal,
      audit: after.audit,
    });
  }
  if (action === "read") {
    const { newsId } = z.object({ newsId: z.string() }).parse(input);
    if (getProfile(userId).answers.length < 5)
      return json({ error: "请先完成5道偏好题。" }, 403);
    if (!news.some((n) => n.id === newsId && eligible(n)))
      return json({ error: "新闻不存在。" }, 404);
    db.prepare("INSERT OR IGNORE INTO personal_reads VALUES (?,?)").run(
      userId,
      newsId,
    );
  } else if (action === "display") {
    const { collapsed } = z.object({ collapsed: z.boolean() }).parse(input);
    db.prepare("INSERT OR REPLACE INTO personal_display VALUES (?,?)").run(
      userId,
      Number(collapsed),
    );
  } else if (action === "language") {
    const { version, text, useNeutral } = versioned
      .extend({
        text: z.string().trim().min(1).max(2000),
        useNeutral: z.boolean().optional(),
      })
      .parse(input);
    const interpreted = interpret(text);
    const existing = getProfile(userId);
    if (useNeutral && existing.description)
      return json({ error: "中性起步仅用于首次注册引导。" }, 400);
    // An explicit neutral choice is available only in onboarding; never partially apply an ambiguous request.
    if (
      (interpreted.unresolved.length || !interpreted.changes.length) &&
      !(useNeutral && !existing.description)
    )
      return json(
        {
          clarification: true,
          error: `暂时无法确定${
            interpreted.unresolved.length
              ? interpreted.unresolved
                  .map((clause) => `「${clause}」`)
                  .join("、")
              : "这段描述"
          }对应的偏好，请分别说明想多看或少看的主题。未修改任何规则。`,
          unresolved: interpreted.unresolved,
        },
        422,
      );
    if (!existing.description && news.filter(eligible).length < 5)
      return json(
        { error: "选题库不足5条通过证据检查的新闻，请补充后再开始。" },
        409,
      );
    mutate(userId, version, (p) => {
      if (!p.description) p.description = text;
      if (!useNeutral) p.rules = applyInterpretation(p.rules, interpreted);
      const summary = useNeutral
        ? "保留需求原文，以中性偏好开始"
        : interpreted.changes.map((c) => `${c.topic}：${c.value}`).join("；");
      return {
        message: `自然语言「${text}」→ ${summary}`,
        undoable: p.answers.length >= 5,
      };
    });
  } else if (action === "answer") {
    const answer = versioned
      .extend({
        newsId: z.string(),
        interest: z.number().int().min(0).max(5).nullable(),
        importance: z.number().int().min(0).max(5).nullable(),
      })
      .parse(input);
    mutate(userId, answer.version, (p) => {
      const question = nextQuestion(p, news);
      if (!question || question.id !== answer.newsId)
        throw new Conflict("题目已变化或已回答，请刷新后继续。");
      p.rules = learn(p.rules, question, answer);
      p.answers.push({
        newsId: answer.newsId,
        interest: answer.interest,
        importance: answer.importance,
      });
      return {
        message: `偏好题「${question.title}」：想读 ${answer.interest ?? "无法判断"}，重要 ${answer.importance ?? "无法判断"}；${question.topic}偏好 ${p.rules.topics[question.topic].toFixed(1)}、重要性修正 ${p.rules.importance[question.topic].toFixed(1)}`,
        undoable: false,
      };
    });
  } else if (action === "settings") {
    const { version, rules } = versioned
      .extend({ rules: rulesSchema })
      .parse(input);
    mutate(userId, version, (p) => {
      if (p.answers.length < 5) throw new Conflict("请先完成5道偏好题。");
      const next: Rules = normalizeRules(rules);
      const changes: string[] = [];
      if ((p.rules.diversity ?? 0) !== (next.diversity ?? 0))
        changes.push(
          `内容多样性：${p.rules.diversity ?? 0} → ${next.diversity ?? 0}`,
        );
      for (const t of topics) {
        if (p.rules.topics[t] !== next.topics[t])
          changes.push(`${t}偏好：${p.rules.topics[t]} → ${next.topics[t]}`);
        if (p.rules.importance[t] !== next.importance[t])
          changes.push(
            `${t}重要性修正：${p.rules.importance[t]} → ${next.importance[t]}`,
          );
      }
      for (const s of new Set([
        ...Object.keys(p.rules.sources),
        ...Object.keys(next.sources),
      ]))
        if ((p.rules.sources[s] || 0) !== (next.sources[s] || 0))
          changes.push(
            `${s}：${p.rules.sources[s] || 0} → ${next.sources[s] || 0}`,
          );
      for (const k of ["relevance", "importance", "freshness"] as const)
        if (p.rules.weights[k] !== next.weights[k])
          changes.push(
            `${{ relevance: "相关性", importance: "重要性", freshness: "时效" }[k]}权重：${p.rules.weights[k]} → ${next.weights[k]}`,
          );
      if (!changes.length) throw new Conflict("设置没有变化。");
      p.rules = next;
      return { message: "设置调整：" + changes.join("；") };
    });
  } else if (action === "feedback") {
    const { version, newsId, topic, direction } = versioned
      .extend({
        newsId: z.string(),
        topic: z.enum(topics),
        direction: z.enum(["more", "less"]),
      })
      .parse(input);
    const item = news.find((n) => n.id === newsId && eligible(n));
    if (!item || item.topic !== topic)
      return json({ error: "请选择这条新闻的具体主题。" }, 400);
    mutate(userId, version, (p) => {
      if (p.answers.length < 5) throw new Conflict("请先完成5道偏好题。");
      if (p.rules.locks.includes(topic))
        throw new Conflict(
          `你已明确屏蔽「${topic}」，请先在设置页解除；反馈未覆盖该限制。`,
        );
      const before = p.rules.topics[topic],
        after = adjustPreference(before, direction === "more" ? 0.5 : -0.5);
      if (before === after) throw new Conflict("该主题偏好已达到调整边界。");
      p.rules.topics[topic] = after;
      return {
        message: `对「${item.title}」反馈：${direction === "more" ? "多看" : "少看"}「${topic}」，${before.toFixed(1)} → ${after.toFixed(1)}；未改变其他主题或来源`,
      };
    });
  } else if (action === "undo") {
    const { version } = versioned.parse(input);
    undo(userId, version);
  } else return json({ error: "接口不存在。" }, 404);
  return json(view(userId, news, note, period));
}
