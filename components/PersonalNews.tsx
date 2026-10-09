"use client";
import { useEffect, useState } from "react";
import {
  topics,
  type FeedItem,
  type PersonalView,
  type Rules,
  type RulePreview,
} from "@/lib/personal-types";
import {
  AlgorithmAudit,
  ScoreBreakdown,
  RuleLab,
} from "./AlgorithmTransparency";
import PeriodPicker from "./PeriodPicker";
import {
  periodQuery,
  resolvePeriod,
  type PeriodChoice,
} from "@/lib/news-period";

class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public clarification = false,
  ) {
    super(message);
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new RequestError(
      data.error || "操作失败，请重试。",
      response.status,
      data.clarification,
    );
  return data;
}
type User = { id: string; username: string; owner: boolean };
const weights = {
  relevance: "个人相关性",
  importance: "新闻重要性",
  freshness: "时效性",
} as const;
export default function PersonalNews() {
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>({
    kind: "all",
  });
  const periodSuffix = periodQuery(resolvePeriod(periodChoice));
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [data, setData] = useState<PersonalView | null>(null),
    [draft, setDraft] = useState<Rules | null>(null);
  const [registering, setRegistering] = useState(true),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [clarification, setClarification] = useState(false);
  const [text, setText] = useState(""),
    [interest, setInterest] = useState(""),
    [importance, setImportance] = useState("");
  const [tab, setTab] = useState<"feed" | "settings">("feed");
  function accept(value: PersonalView) {
    setData(value);
    setDraft(structuredClone(value.profile.rules));
  }
  function report(error: unknown) {
    setMessage(error instanceof Error ? error.message : "操作失败，请重试。");
    setClarification(error instanceof RequestError && error.clarification);
    if (error instanceof RequestError && error.status === 401) {
      setUser(null);
      setData(null);
      setDraft(null);
      setText("");
    }
  }
  async function load() {
    try {
      setUser(await request<User>("session"));
      accept(await request<PersonalView>("personal" + periodSuffix));
    } catch (error) {
      report(error);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function changePeriod(next: PeriodChoice) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await request<PersonalView>(
        "personal" + periodQuery(resolvePeriod(next)),
      );
      accept(result);
      setPeriodChoice(next);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: string, fields: Record<string, unknown> = {}) {
    if (!data || busy) return;
    setBusy(true);
    setMessage("");
    setClarification(false);
    try {
      const result = await request<PersonalView>(
        "personal/" + action + periodSuffix,
        { version: data.profile.version, accountId: user?.id, ...fields },
      );
      accept(result);
      if (!["read", "display"].includes(action))
        setMessage(result.history[0]?.message || "已保存。");
      if (action === "answer") {
        setInterest("");
        setImportance("");
        if (result.ready) setTab("settings");
      }
      if (action === "language") setText("");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  const status = (
    <div className="pn-status" role="status" aria-live="polite">
      {message}
    </div>
  );
  if (user === undefined)
    return (
      <main className="pn-loading">
        <h1>personal_news</h1>
        <p>正在打开你的新闻…</p>
        {status}
        <button onClick={load}>重新加载</button>
      </main>
    );
  if (!user)
    return (
      <main className="login-page">
        <section className="login-art">
          <span className="eyebrow">YOUR NEWS, YOUR RULES</span>
          <h1>
            世界很大，
            <br />
            你有自己的关注。
          </h1>
          <p>
            说说你想了解什么，回答五道新闻偏好题。
            <br />
            从第一份新闻开始，掌握自己的选题与排序。
          </p>
          <div className="paper-emblem">
            知<span>PERSONAL NEWS · 由你定义</span>
          </div>
        </section>
        <form
          className="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            try {
              await request(registering ? "register" : "login", {
                username,
                password,
              });
              setPassword("");
              setText("");
              setData(null);
              await load();
            } catch (error) {
              report(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="brand">
            personal_news<span>我的新闻算法</span>
          </div>
          <h2>{registering ? "建立你的新闻规则" : "欢迎回来"}</h2>
          <label>
            用户名
            <input
              required
              minLength={registering ? 3 : 1}
              maxLength={40}
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            密码
            <input
              required
              type="password"
              minLength={registering ? 10 : 1}
              maxLength={128}
              autoComplete={registering ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {registering && (
            <p>
              用户名至少3个字，可用中文、字母、数字、下划线；密码至少10个字符。
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "正在处理…" : registering ? "注册并开始" : "登录"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRegistering(!registering);
              setMessage("");
            }}
          >
            {registering ? "已有账号？登录" : "创建新账号"}
          </button>
          {status}
          <a href="/">原有私人阅报室</a>
        </form>
      </main>
    );
  function card(item: FeedItem, inPublic = false) {
    return (
      <article className="pn-card" key={item.id} data-news-id={item.id}>
        <div className="pn-meta">
          <span>
            {item.topic} · {item.date}
          </span>
          <span>
            {item.read ? "已读" : "未读"}
            {item.duplicate
              ? inPublic
                ? " · 也在个人推荐中"
                : " · 也在公共重要区"
              : ""}
          </span>
        </div>
        <h3>{item.title}</h3>
        <p>{item.summary}</p>
        <p className="pn-source">
          {item.source} · {item.evidence.note}
        </p>
        <details>
          <summary>
            {inPublic ? "为什么列为公共重要新闻" : "为什么推荐给我"}
          </summary>
          <p>{item.reason}</p>
          {!inPublic && <ScoreBreakdown item={item} />}
          {inPublic && item.publicAssessment && (
            <p>
              影响范围 {item.publicAssessment.reach}/5 · 后果严重程度{" "}
              {item.publicAssessment.severity}/5 · 时效紧迫性{" "}
              {item.publicAssessment.urgency}/5
            </p>
          )}
        </details>
        <div className="pn-actions">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void act("read", { newsId: item.id })}
          >
            阅读来源 ↗
          </a>
          <button
            disabled={busy}
            onClick={() =>
              act("feedback", {
                newsId: item.id,
                topic: item.topic,
                direction: "more",
              })
            }
          >
            多看「{item.topic}」
          </button>
          <button
            disabled={busy}
            onClick={() =>
              act("feedback", {
                newsId: item.id,
                topic: item.topic,
                direction: "less",
              })
            }
          >
            少看「{item.topic}」
          </button>
        </div>
      </article>
    );
  }
  return (
    <div className="pn-shell">
      <header className="pn-header">
        <a className="brand" href="/personal">
          personal_news<span>我的新闻算法</span>
        </a>
        <nav aria-label="个人新闻导航">
          <button
            aria-current={tab === "feed" ? "page" : undefined}
            onClick={() => setTab("feed")}
          >
            我的新闻
          </button>
          <button
            aria-current={tab === "settings" ? "page" : undefined}
            onClick={() => setTab("settings")}
          >
            我的规则
          </button>
          {user.owner && <a href="/">私人阅报室</a>}
        </nav>
        <div className="pn-account">
          <span>{user.username}</span>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request("logout", {});
                setUser(null);
                setData(null);
                setDraft(null);
                setText("");
                setMessage("");
                setInterest("");
                setImportance("");
              } catch (e) {
                report(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            退出
          </button>
        </div>
      </header>
      <main className="pn-main">
        {status}
        {!data && (
          <>
            <p>正在读取个人规则…</p>
            <button onClick={load}>重新加载</button>
          </>
        )}
        {data && (
          <>
            <p className="pn-catalog">{data.catalogNote}</p>
            {!data.profile.description ? (
              <section className="pn-panel pn-onboarding">
                <span className="eyebrow">01 / TELL US WHAT MATTERS</span>
                <h1>从你的关注开始</h1>
                <p>描述关注领域、阅读目的，以及想多看或少看的内容。</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("language", { text });
                  }}
                >
                  <label>
                    我的新闻需求
                    <textarea
                      required
                      maxLength={2000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="例如：多看编程和智能体，少看产业商业"
                    />
                  </label>
                  <p className="pn-help">
                    支持多看／少看及并列主题；AI 使用技巧、AI
                    能力突破归入“模型与编程”。无法识别的部分会具体提示，原文会保留。
                  </p>
                  <p>{topics.join(" · ")}</p>
                  <button className="primary" disabled={busy}>
                    开始五道偏好题 →
                  </button>
                  {clarification && (
                    <button
                      type="button"
                      disabled={busy || !text.trim()}
                      onClick={() =>
                        act("language", { text, useNeutral: true })
                      }
                    >
                      保留原文，先用中性规则答题
                    </button>
                  )}
                </form>
              </section>
            ) : !data.ready ? (
              <section className="pn-panel pn-onboarding">
                <span className="eyebrow">02 / CALIBRATE YOUR PERSPECTIVE</span>
                <h1>同一条新闻，两种判断</h1>
                <p>
                  已完成 {data.profile.answers.length} / 5
                  题。下一题会根据已有回答调整。
                </p>
                <progress
                  max={5}
                  value={data.profile.answers.length}
                  aria-label="偏好题进度"
                />
                {data.question ? (
                  <form
                    key={data.question.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act("answer", {
                        newsId: data.question!.id,
                        interest:
                          interest === "unknown" ? null : Number(interest),
                        importance:
                          importance === "unknown" ? null : Number(importance),
                      });
                    }}
                  >
                    <div className="pn-question">
                      <span>
                        {data.question.topic} · {data.question.date}
                      </span>
                      <h2>{data.question.title}</h2>
                      <p>{data.question.summary}</p>
                      <p className="pn-source">{data.question.evidence.note}</p>
                      <a
                        href={data.question.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        查看来源 ↗
                      </a>
                    </div>
                    <div className="pn-two">
                      {(
                        [
                          ["想不想读", interest, setInterest],
                          ["认为什么程度的重要", importance, setImportance],
                        ] as const
                      ).map(([label, value, setter]) => (
                        <label key={label}>
                          {label}
                          <select
                            required
                            value={value}
                            onChange={(e) => setter(e.target.value)}
                          >
                            <option value="" disabled>
                              请选择
                            </option>
                            {[0, 1, 2, 3, 4, 5].map((v) => (
                              <option key={v} value={v}>
                                {v} 分
                                {v === 0
                                  ? " · 完全不"
                                  : v === 5
                                    ? " · 非常"
                                    : ""}
                              </option>
                            ))}
                            <option value="unknown">不了解／无法判断</option>
                          </select>
                        </label>
                      ))}
                    </div>
                    <p className="pn-help">
                      “无法判断”也算完成，不会当作不喜欢。想读与重要分别学习。
                    </p>
                    <div className="pn-actions">
                      <button
                        className="primary"
                        disabled={busy || !interest || !importance}
                      >
                        {data.profile.answers.length === 4
                          ? "完成并查看我的规则"
                          : "回答并继续 →"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act("answer", {
                            newsId: data.question!.id,
                            interest: null,
                            importance: null,
                          })
                        }
                      >
                        两项都无法判断
                      </button>
                    </div>
                  </form>
                ) : (
                  <p>
                    当前没有足够的合格题目，请补充选题库后继续；已有答案已保存。
                  </p>
                )}
              </section>
            ) : (
              <>
                {tab === "feed" ? (
                  <>
                    <div className="pn-heading">
                      <div>
                        <span className="eyebrow">A PERSONAL PERSPECTIVE</span>
                        <h1>今天，从你关心的开始。</h1>
                      </div>
                      <button onClick={() => setTab("settings")}>
                        调整我的规则 →
                      </button>
                    </div>
                    <PeriodPicker
                      value={periodChoice}
                      onChange={changePeriod}
                      disabled={busy}
                    />
                    <p className="pn-help">
                      按新闻日期筛选个人推荐与公共重要新闻。
                    </p>
                    {data.audit && (
                      <details>
                        <summary>查看本次推荐与过滤过程</summary>
                        <AlgorithmAudit audit={data.audit} />
                      </details>
                    )}
                    <section className="pn-public" aria-label="公共重要新闻">
                      <div className="pn-heading">
                        <div>
                          <h2>
                            公共重要新闻{" "}
                            <span className="count">
                              {data.publicNews.length}
                            </span>
                          </h2>
                          <p>与你是否感兴趣分开判断，始终保留入口。</p>
                        </div>
                        <button
                          aria-expanded={!data.publicCollapsed}
                          disabled={busy}
                          onClick={() =>
                            act("display", { collapsed: !data.publicCollapsed })
                          }
                        >
                          {data.publicCollapsed ? "展开" : "折叠"}
                        </button>
                      </div>
                      {!data.publicCollapsed &&
                        (data.publicNews.length ? (
                          data.publicNews.map((n) => card(n, true))
                        ) : (
                          <p className="pn-empty">
                            所选区间内没有通过证据检查且完成公共影响评估的重要新闻。可扩大时间区间。
                          </p>
                        ))}
                    </section>
                    <section aria-label="个人推荐">
                      <div className="pn-heading">
                        <h2>为你挑选</h2>
                        <span>
                          {data.personal.length} 条 · 规则版本{" "}
                          {data.profile.version}
                        </span>
                      </div>
                      <div className="pn-feed">
                        {data.personal.map((n) => card(n))}
                      </div>
                      {!data.personal.length && (
                        <p className="pn-empty">
                          所选区间内没有符合个人规则的合格新闻，可扩大时间区间或调整主题与来源限制。
                        </p>
                      )}
                    </section>
                  </>
                ) : (
                  draft && (
                    <>
                      <span className="eyebrow">
                        YOUR ALGORITHM, IN PLAIN SIGHT
                      </span>
                      <h1>我的新闻规则</h1>
                      <p className="pn-help">
                        三个入口共同修改这份规则。阅读、停留或未读不会自动调整偏好。
                      </p>
                      <PeriodPicker
                        value={periodChoice}
                        onChange={changePeriod}
                        disabled={busy}
                      />
                      {data.audit && <AlgorithmAudit audit={data.audit} />}
                      <section className="pn-panel">
                        <h2>用一句话调整</h2>
                        <p>原始需求：{data.profile.description}</p>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void act("language", { text });
                          }}
                        >
                          <label>
                            调整要求
                            <textarea
                              required
                              maxLength={2000}
                              value={text}
                              onChange={(e) => setText(e.target.value)}
                              placeholder="例如：多看科研，屏蔽产业商业，恢复智能体默认"
                            />
                          </label>
                          <p className="pn-help">
                            无法完整理解时不会修改。也可以使用下面的参数设置。
                          </p>
                          <button className="primary" disabled={busy}>
                            应用这句话
                          </button>
                        </form>
                      </section>
                      <form
                        className="pn-panel"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act("settings", { rules: draft });
                        }}
                      >
                        <h2>主题与来源</h2>
                        <p className="pn-help">
                          主题偏好 −2 为屏蔽、0 为中性、2
                          为偏好。明确屏蔽优先于学习；公共重要区独立保留。
                        </p>
                        <div className="pn-topic-grid">
                          {topics.map((t) => (
                            <div key={t}>
                              <label>
                                {t}偏好{" "}
                                <output>
                                  {draft.topics[t].toFixed(1)}
                                  {draft.topics[t] === -2 ? " · 屏蔽" : ""}
                                </output>
                                <input
                                  aria-label={t + "偏好"}
                                  type="range"
                                  min={-2}
                                  max={2}
                                  step={0.1}
                                  value={draft.topics[t]}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      topics: {
                                        ...draft.topics,
                                        [t]: Number(e.target.value),
                                      },
                                    })
                                  }
                                />
                              </label>
                              <label>
                                {t}重要性修正
                                <input
                                  type="number"
                                  min={-2}
                                  max={2}
                                  step={0.1}
                                  value={draft.importance[t]}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      importance: {
                                        ...draft.importance,
                                        [t]: Number(e.target.value),
                                      },
                                    })
                                  }
                                />
                              </label>
                            </div>
                          ))}
                        </div>
                        <details>
                          <summary>
                            来源偏好 ·{" "}
                            {
                              new Set([
                                ...data.sources,
                                ...Object.keys(draft.sources),
                              ]).size
                            }{" "}
                            个来源
                          </summary>
                          <div className="pn-topic-grid">
                            {[
                              ...new Set([
                                ...data.sources,
                                ...Object.keys(draft.sources),
                              ]),
                            ]
                              .sort()
                              .map((s) => (
                                <label key={s}>
                                  {s}
                                  {!data.sources.includes(s)
                                    ? "（当前无候选）"
                                    : ""}
                                  <select
                                    value={draft.sources[s] || 0}
                                    onChange={(e) =>
                                      setDraft({
                                        ...draft,
                                        sources: {
                                          ...draft.sources,
                                          [s]: Number(e.target.value),
                                        },
                                      })
                                    }
                                  >
                                    <option value={0}>中性</option>
                                    {![-2, -1, 0, 1].includes(
                                      draft.sources[s] || 0,
                                    ) && (
                                      <option value={draft.sources[s]}>
                                        自定义偏好 {draft.sources[s]}
                                      </option>
                                    )}
                                    <option value={1}>优先</option>
                                    <option value={-1}>减少</option>
                                    <option value={-2}>屏蔽个人推荐</option>
                                  </select>
                                </label>
                              ))}
                          </div>
                        </details>
                        <h2>排序的取舍</h2>
                        <p className="pn-help">
                          按相对比例计算，至少保留一项大于0；默认 50 : 30 : 20。
                        </p>
                        <div className="pn-topic-grid">
                          {(
                            Object.keys(weights) as (keyof typeof weights)[]
                          ).map((k) => (
                            <label key={k}>
                              {weights[k]} <output>{draft.weights[k]}</output>
                              <input
                                aria-label={weights[k]}
                                type="range"
                                min={0}
                                max={100}
                                value={draft.weights[k]}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    weights: {
                                      ...draft.weights,
                                      [k]: Number(e.target.value),
                                    },
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <div className="pn-diversity">
                          <h2>给不同内容留一点位置</h2>
                          <label>
                            内容多样性{" "}
                            <output>{draft.diversity ?? 0} / 30</output>
                            <input
                              type="range"
                              aria-label="内容多样性"
                              min={0}
                              max={30}
                              step={1}
                              value={draft.diversity ?? 0}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  diversity: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          <p className="pn-help">
                            0
                            为关闭，保持基础分排序。提高后，相同主题的后续新闻最多减去该数值，同来源不同主题减去一半；只改变通过过滤的候选顺序，不解除屏蔽。它衡量标签重复，不能保证观点更多样。
                          </p>
                        </div>
                        <button
                          className="primary"
                          disabled={
                            busy ||
                            Object.values(draft.weights).every((v) => v === 0)
                          }
                        >
                          保存参数并重新排序
                        </button>
                      </form>
                      <RuleLab
                        key={`${data.profile.version}:${periodSuffix}`}
                        data={data}
                        draft={draft}
                        setDraft={setDraft}
                        disabled={busy}
                        setBusy={setBusy}
                        previewRules={(rules) =>
                          request<RulePreview>(
                            "personal/preview" + periodSuffix,
                            {
                              version: data.profile.version,
                              accountId: user.id,
                              rules,
                            },
                          )
                        }
                      />
                      <section className="pn-panel">
                        <div className="pn-heading">
                          <h2>规则变更记录</h2>
                          <button
                            disabled={
                              busy ||
                              !data.history.some((h) => h.undoable && !h.undone)
                            }
                            onClick={() => act("undo")}
                          >
                            撤销最近一次调整
                          </button>
                        </div>
                        <p className="pn-help">
                          初始校准保留为记录，之后的调整可逐次撤销。
                        </p>
                        <ol className="pn-history">
                          {data.history.map((h) => (
                            <li key={h.id}>
                              <time>
                                {new Date(h.at).toLocaleString("zh-CN")}
                              </time>
                              <p>
                                {h.message}
                                {h.undone ? "（已撤销）" : ""}
                              </p>
                            </li>
                          ))}
                        </ol>
                      </section>
                    </>
                  )
                )}
                <footer className="pn-footer">
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        accept(
                          await request<PersonalView>(
                            "personal" + periodSuffix,
                          ),
                        );
                        setMessage("已读取最新规则。");
                      } catch (e) {
                        report(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    刷新服务器规则
                  </button>
                  <span>不同账号的偏好、反馈和已读记录独立保存。</span>
                </footer>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
