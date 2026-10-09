"use client";
import { useState } from "react";
import type {
  FeedAudit,
  FeedItem,
  PersonalView,
  RulePreview,
  Rules,
} from "@/lib/personal-types";
import { exportRecipe, importRecipe } from "@/lib/personal-rules";

export function ScoreBreakdown({ item }: { item: FeedItem }) {
  return (
    <div className="pn-score">
      <p>
        <strong>基础分 {item.score.toFixed(1)} / 100</strong> ·
        分数用于排序，不是新闻可信度或喜欢概率。
      </p>
      {item.breakdown?.map((part) => (
        <div className="pn-signal" key={part.key}>
          <div>
            <span>{part.label}</span>
            <strong>贡献 {part.contribution.toFixed(1)} 分</strong>
          </div>
          <meter
            min={0}
            max={100}
            value={part.contribution}
            aria-label={`${part.label}贡献分`}
          />
          <small>
            信号 {part.signal.toFixed(1)} × 权重 {part.weight.toFixed(1)}%
          </small>
          <details>
            <summary>查看计算依据</summary>
            <p>{part.basis}</p>
          </details>
        </div>
      ))}
      {item.ranking && (
        <p className="pn-help">
          基础名次 {item.ranking.baseRank} → 展示名次 {item.ranking.position}。
          {item.ranking.penalty > 0
            ? ` 本轮选择时减 ${item.ranking.penalty.toFixed(1)} 分：与已选的「${item.ranking.similarTo}」有相同主题或来源；选择分为 ${item.ranking.selectionScore.toFixed(1)}。`
            : " 本轮选择时没有多样性扣分。"}
          多样性调整逐条选择，选择分随已选内容变化；显示数值四舍五入。
        </p>
      )}
    </div>
  );
}

export function AlgorithmAudit({ audit }: { audit: FeedAudit }) {
  const [query, setQuery] = useState("");
  const rows = audit.excluded.filter((n) =>
    (n.title + n.reason).includes(query),
  );
  return (
    <section className="pn-panel pn-audit" aria-label="推荐筛选过程">
      <span className="eyebrow">从候选到你的新闻</span>
      <h2>每一步，都看得见</h2>
      <p className="pn-help">
        {audit.period
          ? `${audit.period.start} 至 ${audit.period.end}`
          : "全部时间"}{" "}
        · 当前已导入新闻库，不代表全网新闻。
      </p>
      <ol className="pn-pipeline">
        {audit.stages.map((stage, i) => (
          <li key={stage.label}>
            <span>
              {String(i + 1).padStart(2, "0")} / {stage.label}
            </span>
            <strong>
              {stage.count}
              <small> 条</small>
            </strong>
            <small>
              {i ? `本步减少 ${stage.removed} 条` : "本次可检查的候选"}
            </small>
          </li>
        ))}
      </ol>
      <p className="pn-branch">
        从证据门槛另分一路 → 公共重要新闻{" "}
        <strong>{audit.publicCount} 条</strong>。独立按影响、严重性、紧迫性均 ≥
        3/5 判断，不受个人屏蔽或排序权重影响。
      </p>
      <details>
        <summary>为什么没出现在个人推荐中？{audit.excluded.length} 条</summary>
        <p className="pn-help">
          按流程记录最先未通过的一步。通过过滤但排在前20条之外，会单独注明；证据未通过的标题仅供核对，不表示事实已核实。
        </p>
        <label>
          查找未入选新闻
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <ul className="pn-exclusions">
          {rows.map((n) => (
            <li key={n.id}>
              <strong>{n.title}</strong>
              <p>
                {n.reason}
                {n.public ? "；仍在公共重要区" : ""}
              </p>
            </li>
          ))}
        </ul>
        {!rows.length && <p>没有匹配的未入选新闻。</p>}
      </details>
      <details>
        <summary>当前算法与数据边界</summary>
        <p>
          先执行时间和证据检查，再执行你的屏蔽条件，按相关性、重要性和时效性加权，最后按可选的多样性设置选取最多20条。基础分相同时按日期较新、编号顺序排序。来源偏好不等于来源可信度，证据状态来自编辑记录。
        </p>
        <p>
          相关性目前使用主题与来源标签；尚未使用语义搜索、点击预测或自动立场分类。阅读、停留和未读不会偷偷修改偏好。
        </p>
        <p className="pn-help">
          计算时间：
          {new Date(audit.at).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
          })}
          （北京时间） · 算法版本 {audit.engine}
        </p>
      </details>
    </section>
  );
}

function Coverage({ items, title }: { items: FeedItem[]; title: string }) {
  const counts = new Map<string, number>();
  items
    .slice(0, 5)
    .forEach((n) => counts.set(n.topic, (counts.get(n.topic) || 0) + 1));
  return (
    <div className="pn-coverage">
      <h3>{title}</h3>
      <p>
        {items.length} 条 · {new Set(items.map((n) => n.topic)).size} 个主题 ·{" "}
        {new Set(items.map((n) => n.source)).size} 个来源
      </p>
      <div className="pn-distribution">
        {[...counts].map(([topic, count]) => (
          <div key={topic}>
            <span>{topic}</span>
            <meter
              value={count}
              max={5}
              min={0}
              aria-label={`${title}前5条中的${topic}`}
            />
            <strong>{count}</strong>
          </div>
        ))}
      </div>
      <small>
        以上分布只看前 {Math.min(5, items.length)}{" "}
        条；主题数与来源数不代表观点多样性。
      </small>
    </div>
  );
}

export function RuleLab({
  data,
  draft,
  setDraft,
  disabled,
  setBusy,
  previewRules,
}: {
  data: PersonalView;
  draft: Rules;
  setDraft: (rules: Rules) => void;
  disabled: boolean;
  setBusy: (busy: boolean) => void;
  previewRules: (rules: Rules) => Promise<RulePreview>;
}) {
  const [preview, setPreview] = useState<{
    value: RulePreview;
    rules: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const current =
    preview?.rules === JSON.stringify(draft) ? preview.value : null;
  const changed = JSON.stringify(draft) !== JSON.stringify(data.profile.rules);
  const before = current?.before || data.personal;
  const after = current?.after || [];
  const entries = [
    ...after,
    ...before.filter((n) => !after.some((a) => a.id === n.id)),
  ];
  return (
    <>
      <section className="pn-panel pn-lab" aria-label="规则效果预览">
        <span className="eyebrow">先看变化，再决定</span>
        <h2>这份规则，会带来什么？</h2>
        <p>
          调整主题、来源或排序取舍后，用当前新闻库试算。预览不会保存设置，也不会记录阅读或训练偏好。
        </p>
        <button
          type="button"
          className="primary"
          disabled={
            disabled || Object.values(draft.weights).every((v) => v === 0)
          }
          onClick={async () => {
            setBusy(true);
            setMessage("");
            try {
              const rules = JSON.stringify(draft);
              const value = await previewRules(draft);
              setPreview({ value, rules });
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "预览失败，请重试。");
            } finally {
              setBusy(false);
            }
          }}
        >
          预览调整效果
        </button>
        <p className="pn-help" role="status">
          {current
            ? "正在展示草稿试算；尚未保存。"
            : changed
              ? "参数已改变，点击预览查看新的结果。"
              : "当前展示已保存规则的结果。"}
        </p>
        <div className="pn-comparison">
          <Coverage items={before} title="当前规则" />
          {current && <Coverage items={after} title="调整后" />}
        </div>
        {current && (
          <>
            <p className="pn-help">
              两组使用同一候选库、时间范围和计算时点。下面对比全部入选新闻；未入选原因见下方账本。
            </p>
            <ol className="pn-preview-list">
              {entries.map((n) => {
                const oldIndex = before.findIndex((x) => x.id === n.id),
                  newIndex = after.findIndex((x) => x.id === n.id);
                return (
                  <li key={n.id}>
                    <span className="pn-rank-change">
                      {oldIndex < 0 ? "未入选" : `#${oldIndex + 1}`} →{" "}
                      {newIndex < 0 ? "未入选" : `#${newIndex + 1}`}
                    </span>
                    <div>
                      <strong>{n.title}</strong>
                      <small>
                        {n.topic} · {n.source}
                      </small>
                      {newIndex >= 0 && (
                        <details>
                          <summary>查看调整后的评分</summary>
                          <ScoreBreakdown item={n} />
                        </details>
                      )}
                      {newIndex < 0 && (
                        <p>
                          {
                            current.audit.excluded.find((x) => x.id === n.id)
                              ?.reason
                          }
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {!entries.length && (
              <p>两组都没有入选新闻，可查看过滤原因或扩大时间范围。</p>
            )}
          </>
        )}
      </section>
      {current && <AlgorithmAudit audit={current.audit} />}
      <section className="pn-panel" aria-label="分享新闻规则">
        <h2>把你的新闻规则，交给别人试试</h2>
        <p>
          导出已保存的主题、来源、重要性修正、排序权重和多样性设置。文件不包含账号、原始需求、问卷答案、阅读记录或笔记。主题和来源偏好本身会展示给收到文件的人。
        </p>
        <div className="pn-actions">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              try {
                const blob = new Blob(
                  [JSON.stringify(exportRecipe(data.profile.rules), null, 2)],
                  { type: "application/json" },
                );
                if (blob.size > 100000)
                  throw new Error(
                    "规则文件超过100KB，请减少来源设置后再导出。",
                  );
                const url = URL.createObjectURL(blob),
                  link = document.createElement("a");
                link.href = url;
                link.download = "personal-news-rules.json";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                setMessage("已导出已保存的规则；未保存的草稿没有包含在内。");
              } catch (e) {
                setMessage(
                  e instanceof Error ? e.message : "导出失败，请检查设置。",
                );
              }
            }}
          >
            导出已保存规则
          </button>
          <label>
            导入规则文件
            <input
              type="file"
              accept=".json,application/json"
              disabled={disabled}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setMessage("");
                try {
                  if (file.size > 100000)
                    throw new Error("请选择100KB以内的规则文件。");
                  const rules = importRecipe(await file.text());
                  setDraft(rules);
                  setPreview(null);
                  const dormant = Object.keys(rules.sources).filter(
                    (s) => !data.sources.includes(s),
                  );
                  setMessage(
                    `规则已载入草稿。先检查上方参数、预览，再点击“保存参数并重新排序”生效；可撤销。${dormant.length ? ` 有 ${dormant.length} 个来源不在当前新闻库中，其设置会保留，暂不影响结果。` : ""}`,
                  );
                } catch (e) {
                  setMessage(
                    e instanceof Error ? e.message : "无法读取规则文件。",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
        </div>
        <p className="pn-help">
          复制规则不会订阅原作者的后续更改；不同新闻库和时间范围可能得到不同结果。公开链接与规则广场尚未提供。
        </p>
      </section>
      {message && (
        <p className="pn-status" role="status">
          {message}
        </p>
      )}
    </>
  );
}
