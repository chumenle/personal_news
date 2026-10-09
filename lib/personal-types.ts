export const topics = [
  "模型与编程",
  "智能体",
  "芯片与基础设施",
  "科研",
  "创作工具",
  "公共治理",
  "产业商业",
  "娱乐",
] as const;
export type Topic = (typeof topics)[number];
export type Rules = {
  topics: Record<Topic, number>;
  importance: Record<Topic, number>;
  locks: Topic[];
  sources: Record<string, number>;
  weights: { relevance: number; importance: number; freshness: number };
  diversity?: number;
};
export type News = {
  id: string;
  title: string;
  summary: string;
  topic: Topic;
  source: string;
  url: string;
  date: string;
  evidence: { approved: boolean; note: string };
  importance: number;
  publicAssessment?: {
    reach: number;
    severity: number;
    urgency: number;
    reason: string;
  };
};
export type Answer = {
  newsId: string;
  interest: number | null;
  importance: number | null;
};
export type Profile = {
  version: number;
  description: string;
  rules: Rules;
  answers: Answer[];
};
export type Change = {
  id: string;
  message: string;
  at: string;
  undone: boolean;
  undoable: boolean;
};
export type FeedItem = News & {
  score: number;
  reason: string;
  read: boolean;
  duplicate: boolean;
  breakdown?: ScorePart[];
  ranking?: {
    baseRank: number;
    position: number;
    penalty: number;
    selectionScore: number;
    similarTo: string | null;
  };
};
export type ScorePart = {
  key: keyof Rules["weights"];
  label: string;
  signal: number;
  weight: number;
  contribution: number;
  basis: string;
};
export type FeedAudit = {
  engine: string;
  at: string;
  period: { start: string; end: string } | null;
  stages: { label: string; count: number; removed: number }[];
  excluded: { id: string; title: string; reason: string; public: boolean }[];
  publicCount: number;
};
export type RulePreview = {
  before: FeedItem[];
  after: FeedItem[];
  audit: FeedAudit;
};
export type PersonalView = {
  profile: Profile;
  question: News | null;
  ready: boolean;
  history: Change[];
  personal: FeedItem[];
  publicNews: FeedItem[];
  publicCollapsed: boolean;
  sources: string[];
  catalogNote: string;
  audit: FeedAudit | null;
};
