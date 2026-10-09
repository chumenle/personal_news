import {
  topics,
  type Topic,
  type Rules,
  type News,
  type Profile,
  type Answer,
  type FeedItem,
  type FeedAudit,
  type ScorePart,
} from "./personal-types";
import { inPeriod, type NewsPeriod } from "./news-period";
import { engineVersion } from "./personal-rules";

const clamp = (v: number) => Math.round(Math.max(-2, Math.min(2, v)) * 10) / 10;
// Learning may reduce affinity, but cannot create an explicit block or reverse a requested reduction.
export function adjustPreference(before: number, delta: number) {
  const after =
    delta < 0
      ? Math.min(before, Math.max(-1.9, before + delta))
      : Math.min(2, before + delta);
  return Math.round(after * 10) / 10;
}
export function defaultRules(): Rules {
  return {
    topics: Object.fromEntries(topics.map((t) => [t, 0])) as Rules["topics"],
    importance: Object.fromEntries(
      topics.map((t) => [t, 0]),
    ) as Rules["importance"],
    locks: [],
    sources: {},
    weights: { relevance: 50, importance: 30, freshness: 20 },
  };
}
export const initialProfile = (): Profile => ({
  version: 0,
  description: "",
  rules: defaultRules(),
  answers: [],
});
export const eligible = (n: News) =>
  n.evidence.approved && /^https?:\/\//.test(n.url);
export function isPublic(n: News): boolean {
  const p = n.publicAssessment;
  return (
    !!p && eligible(n) && p.reach >= 3 && p.severity >= 3 && p.urgency >= 3
  );
}
const aliases: Record<Topic, string[]> = {
  模型与编程: [
    "模型与编程",
    "编程",
    "模型",
    "开发",
    "代码",
    "ai使用技巧",
    "ai使用方法",
    "ai应用技巧",
    "ai能力突破",
    "人工智能使用技巧",
    "人工智能使用方法",
    "人工智能应用技巧",
    "人工智能能力突破",
  ],
  智能体: ["智能体", "agent"],
  芯片与基础设施: ["芯片与基础设施", "芯片", "基础设施", "硬件", "算力"],
  科研: ["科研", "科学", "论文", "研究"],
  创作工具: ["创作工具", "绘画", "图像", "视频"],
  公共治理: ["公共治理", "治理", "监管", "政策", "安全"],
  产业商业: ["产业商业", "商业", "产业", "收购", "融资"],
  娱乐: ["娱乐", "八卦"],
};
export type Interpretation = {
  changes: { topic: Topic; value: number }[];
  unresolved: string[];
};
// Conservative local intent parsing: ambiguous clauses never silently become rules.
export function interpret(text: string): Interpretation {
  const changes = new Map<Topic, number>(),
    unresolved: string[] = [];
  for (const clause of text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, (space) => (space.includes("\n") ? "\n" : ""))
    .split(/[，,。；;\n]|但是|但/g)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const matches = topics.filter((t) =>
      aliases[t].some((a) => clause.includes(a)),
    );
    const neutral = /恢复.*默认|恢复.*中性|取消.*偏好/.test(clause);
    const negative =
      /少看|减少|不喜欢|不关注|不想看|不感兴趣|不要|屏蔽|排除/.test(clause);
    const positive = /多看|增加|喜欢|关注|想看|优先|感兴趣/.test(clause);
    const hard = /屏蔽|排除|不要/.test(clause);
    const ambiguous =
      /不是|并非|不减少|不少看|不屏蔽|不排除|不优先|不太|不怎么|除了|只看|只要|相比|比.*更|如果|还是|\?|？/.test(
        clause,
      ) ||
      (/或/.test(clause) && (!negative || neutral));
    const mixed = negative && /多看|增加|优先/.test(clause);
    const intents =
      clause.match(
        /不感兴趣|不喜欢|不关注|不想看|多看|少看|减少|增加|喜欢|关注|想看|优先|感兴趣|不要|屏蔽|排除|恢复|取消/g,
      ) || [];
    let remainder = clause;
    for (const alias of Object.values(aliases)
      .flat()
      .sort((a, b) => b.length - a.length))
      remainder = remainder.replaceAll(alias, "");
    remainder = remainder.replace(
      /不感兴趣|不喜欢|不关注|不想看|多看|少看|减少|增加|喜欢|关注|想看|优先|感兴趣|不要|屏蔽|排除|恢复|默认|中性|取消|偏好|希望|想要|新闻|内容|相关|进展|更多|一点|一些|或者|或|我|对|的|和|与|及|、|\s/g,
      "",
    );
    if (
      !matches.length ||
      ambiguous ||
      mixed ||
      intents.length !== 1 ||
      remainder ||
      (!neutral && !negative && !positive)
    ) {
      unresolved.push(clause);
      continue;
    }
    for (const topic of matches) {
      const value = neutral ? 0 : negative ? (hard ? -2 : -1) : 1;
      if (changes.has(topic) && changes.get(topic) !== value)
        unresolved.push(clause);
      changes.set(topic, value);
    }
  }
  return {
    changes: [...changes].map(([topic, value]) => ({ topic, value })),
    unresolved,
  };
}
export function applyInterpretation(
  rules: Rules,
  result: Interpretation,
): Rules {
  const next = structuredClone(rules);
  for (const { topic, value } of result.changes) {
    next.topics[topic] = value;
    next.locks = next.locks.filter((t) => t !== topic);
    if (value === -2) next.locks.push(topic);
  }
  return next;
}
export function learn(rules: Rules, news: News, answer: Answer): Rules {
  const next = structuredClone(rules);
  if (!next.locks.includes(news.topic) && answer.interest !== null)
    next.topics[news.topic] = adjustPreference(
      next.topics[news.topic],
      (answer.interest - 2.5) / 5,
    );
  if (answer.importance !== null)
    next.importance[news.topic] = clamp(
      next.importance[news.topic] + (answer.importance - 2.5) / 5,
    );
  return next;
}
export function nextQuestion(profile: Profile, catalog: News[]): News | null {
  if (!profile.description || profile.answers.length >= 5) return null;
  const answered = new Set(profile.answers.map((a) => a.newsId));
  const counts = (topic: Topic) =>
    profile.answers.filter(
      (a) => catalog.find((n) => n.id === a.newsId)?.topic === topic,
    ).length;
  const last = profile.answers.at(-1),
    lastNews = catalog.find((n) => n.id === last?.newsId);
  const followUp = (n: News) =>
    profile.answers.length % 2 === 1 &&
    n.topic === lastNews?.topic &&
    counts(n.topic) < 2 &&
    ((last?.interest ?? 0) >= 4 || (last?.importance ?? 0) >= 4)
      ? 15
      : 0;
  const priority = (n: News) =>
    -counts(n.topic) * 10 +
    followUp(n) +
    (profile.answers.length % 2 === 0
      ? profile.rules.topics[n.topic]
      : -Math.abs(profile.rules.topics[n.topic]));
  return (
    catalog
      .filter((n) => eligible(n) && !answered.has(n.id))
      .sort(
        (a, b) => priority(b) - priority(a) || a.id.localeCompare(b.id),
      )[0] || null
  );
}
export function rank(
  profile: Profile,
  catalog: News[],
  read: Set<string>,
  now = Date.now(),
): { personal: FeedItem[]; publicNews: FeedItem[] } {
  const { personal, publicNews } = rankWithAudit(profile, catalog, read, now);
  return { personal, publicNews };
}
export function rankWithAudit(
  profile: Profile,
  catalog: News[],
  read: Set<string>,
  now = Date.now(),
  period: NewsPeriod | null = null,
): { personal: FeedItem[]; publicNews: FeedItem[]; audit: FeedAudit } {
  const r = profile.rules,
    total = Object.values(r.weights).reduce((a, b) => a + b, 0) || 1;
  const excluded: FeedAudit["excluded"] = [];
  const stages: FeedAudit["stages"] = [
    { label: "候选新闻", count: catalog.length, removed: 0 },
  ];
  const step = (
    items: News[],
    label: string,
    reason: (n: News) => string | null,
  ) => {
    const remaining = items.filter((n) => {
      const why = reason(n);
      if (why)
        excluded.push({ id: n.id, title: n.title, reason: why, public: false });
      return !why;
    });
    stages.push({
      label,
      count: remaining.length,
      removed: items.length - remaining.length,
    });
    return remaining;
  };
  const dated = step(catalog, "时间范围", (n) =>
    inPeriod(n.date, period) ? null : "不在所选时间范围内",
  );
  const approved = step(dated, "证据门槛", (n) =>
    eligible(n) ? null : `未通过证据／链接检查：${n.evidence.note}`,
  );
  const allowed = step(approved, "个人过滤", (n) => {
    const reasons = [];
    if (r.locks.includes(n.topic)) reasons.push(`已屏蔽主题「${n.topic}」`);
    if (r.sources[n.source] === -2) reasons.push(`已屏蔽来源「${n.source}」`);
    return reasons.join("；") || null;
  });
  const scored: FeedItem[] = allowed
    .map((n) => {
      const affinity = Math.max(
        0,
        Math.min(
          1,
          0.5 + r.topics[n.topic] / 4 + (r.sources[n.source] || 0) / 8,
        ),
      );
      const importance = Math.max(
        0,
        Math.min(1, n.importance / 5 + r.importance[n.topic] / 10),
      );
      const age = Math.max(0, (now - Date.parse(n.date)) / 86400000);
      const freshness = Math.exp(-age / 14);
      const signals = { relevance: affinity, importance, freshness };
      const labels = {
        relevance: "个人相关性",
        importance: "新闻重要性",
        freshness: "时效性",
      };
      const bases = {
        relevance: `主题偏好 ${r.topics[n.topic]}；来源偏好 ${r.sources[n.source] || 0}。信号 = 限定到0–1的(0.5 + 主题/4 + 来源/8)。`,
        importance: `编辑评估 ${n.importance}/5；你的主题修正 ${r.importance[n.topic]}。信号 = 限定到0–1的(编辑评估/5 + 修正/10)。`,
        freshness: `按条目日期 ${n.date} 计算，距计算时点 ${age.toFixed(1)} 天；信号 = exp(−天数/14)。历史归档日期不一定是发布日期。`,
      };
      const breakdown: ScorePart[] = (
        Object.keys(signals) as (keyof typeof signals)[]
      ).map((key) => ({
        key,
        label: labels[key],
        signal: signals[key] * 100,
        weight: (r.weights[key] / total) * 100,
        contribution: ((signals[key] * r.weights[key]) / total) * 100,
        basis: bases[key],
      }));
      const score = breakdown.reduce((sum, part) => sum + part.contribution, 0);
      const reason = `${n.topic}偏好 ${r.topics[n.topic].toFixed(1)}，来源偏好 ${r.sources[n.source] || 0}；相关性 ${Math.round(affinity * 100)}、重要性 ${Math.round(importance * 100)}、时效 ${Math.round(freshness * 100)}，按 ${r.weights.relevance}:${r.weights.importance}:${r.weights.freshness} 加权。`;
      return {
        ...n,
        score,
        reason,
        breakdown,
        read: read.has(n.id),
        duplicate: false,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.date.localeCompare(a.date) ||
        a.id.localeCompare(b.id),
    );
  // Greedy MMR-style re-ranking. Tags are a coarse proxy, not semantic or political similarity.
  const remaining = scored.map((n, i) => ({ ...n, baseRank: i + 1 }));
  const personal: FeedItem[] = [];
  while (remaining.length && personal.length < 20) {
    const choices = remaining.map((n, i) => {
      let similarity = 0,
        similarTo: string | null = null;
      for (const selected of personal) {
        const value =
          n.topic === selected.topic
            ? 1
            : n.source === selected.source
              ? 0.5
              : 0;
        if (value > similarity) {
          similarity = value;
          similarTo = selected.title;
        }
      }
      const penalty = (r.diversity ?? 0) * similarity;
      return { n, i, penalty, similarTo, selectionScore: n.score - penalty };
    });
    choices.sort(
      (a, b) =>
        b.selectionScore - a.selectionScore || a.n.baseRank - b.n.baseRank,
    );
    const best = choices[0];
    const { baseRank, ...item } = best.n;
    personal.push({
      ...item,
      ranking: {
        baseRank,
        position: personal.length + 1,
        penalty: best.penalty,
        selectionScore: best.selectionScore,
        similarTo: best.penalty ? best.similarTo : null,
      },
    });
    remaining.splice(best.i, 1);
  }
  for (const n of remaining)
    excluded.push({
      id: n.id,
      title: n.title,
      reason: `通过过滤，但未进入本次前20条；基础分 ${n.score.toFixed(1)}，基础名次 ${n.baseRank}`,
      public: false,
    });
  stages.push({
    label: "排序入选",
    count: personal.length,
    removed: remaining.length,
  });
  const personalIds = new Set(personal.map((n) => n.id));
  const publicNews = approved
    .filter(isPublic)
    .sort((a, b) => {
      const strength = (n: News) =>
        n.publicAssessment!.reach +
        n.publicAssessment!.severity +
        n.publicAssessment!.urgency;
      return strength(b) - strength(a) || a.id.localeCompare(b.id);
    })
    .map((n) => ({
      ...n,
      score: 0,
      reason: n.publicAssessment!.reason,
      read: read.has(n.id),
      duplicate: personalIds.has(n.id),
    }));
  const publicIds = new Set(publicNews.map((n) => n.id));
  return {
    personal: personal.map((n) => ({ ...n, duplicate: publicIds.has(n.id) })),
    publicNews,
    audit: {
      engine: engineVersion,
      at: new Date(now).toISOString(),
      period,
      stages,
      excluded: excluded.map((n) => ({ ...n, public: publicIds.has(n.id) })),
      publicCount: publicNews.length,
    },
  };
}
