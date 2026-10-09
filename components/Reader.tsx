"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Annotation, Draft, Edition } from "@/lib/types";
import PeriodPicker from './PeriodPicker';
import { inPeriod, resolvePeriod, type PeriodChoice } from '@/lib/news-period';
const PdfDocument = dynamic(() => import("./PdfDocument"), {
  ssr: false,
  loading: () => <div className="loading-paper">正在准备阅读器…</div>,
});
const colorLabels = {
  yellow: "黄色",
  green: "绿色",
  blue: "蓝色",
  pink: "粉色",
} as const;
const draftKey = "personal-news-drafts-v1";
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/${url}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(result.error || "操作失败，请重试。", response.status);
  return result;
}
export default function Reader() {
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>({ kind: 'all' });
  const [signedIn, setSignedIn] = useState<boolean | null>(null),
    [username, setUsername] = useState("owner"),
    [password, setPassword] = useState("");
  const [items, setItems] = useState<Edition[]>([]),
    [editionId, setEditionId] = useState(""),
    [screen, setScreen] = useState<"read" | "archive" | "notes">("read");
  const [marks, setMarks] = useState<Annotation[]>([]),
    [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [online, setOnline] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("");
  const [width, setWidth] = useState(800),
    [zoom, setZoom] = useState(1),
    [page, setPage] = useState(1),
    [focusId, setFocusId] = useState<string | null>(null),
    [pdfReady, setPdfReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null),
    progressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
  const selectionRef = useRef<Pick<Draft, "quote" | "rects" | "page"> | null>(
    null,
  );
  const [selected, setSelected] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (!draft) return;
    const dialog = document.querySelector<HTMLElement>(".note-editor");
    const previous = document.activeElement as HTMLElement | null;
    dialog?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setDraft(null);
        setConflict(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,textarea,select,[tabindex="0"]',
        ),
      );
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [draft?.id, busy]);
  const edition = items.find((item) => item.id === editionId),
    current = marks.filter((a) => a.editionId === editionId);
  const visibleEditions = items.filter(item => inPeriod(item.date, resolvePeriod(periodChoice)));
  const loadMarks = useCallback(async () => {
    const rows = await api<Annotation[]>("annotations");
    setMarks(rows);
    return rows;
  }, []);
  const report = useCallback((error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    setMessage(text);
    if (error instanceof ApiError && error.status === 401) setSignedIn(false);
  }, []);
  useEffect(() => {
    api<{ owner: boolean }>("session")
      .then((session) => {
        if (!session.owner) { window.location.replace('/personal'); return; }
        setSignedIn(true);
        try {
          const saved = JSON.parse(localStorage.getItem(draftKey) || '{}');
          if (saved && typeof saved === 'object') setDrafts(saved);
        } catch {}
      })
      .catch(() => setSignedIn(false));
    setOnline(navigator.onLine);
    setNotesOpen(window.innerWidth > 800);
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    Promise.all([api<Edition[]>("editions"), loadMarks()])
      .then(([editions]) => {
        setItems(editions);
        const params = new URLSearchParams(location.search),
          requested = params.get("edition");
        setEditionId(
          editions.some((e) => e.id === requested)
            ? requested!
            : editions[0]?.id || "",
        );
        setFocusId(params.get("annotation"));
      })
      .catch(report);
    const refresh = () => {
      if (document.visibilityState === "visible")
        void loadMarks().catch(report);
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [signedIn, loadMarks, report]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setWidth(Math.min(960, Math.max(280, element.clientWidth - 40))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [signedIn, screen, notesOpen, editionId]);
  useEffect(() => {
    setPdfReady(false);
    setPage(1);
    setZoom(1);
    clearTimeout(progressTimer.current);
  }, [editionId]);
  const jump = useCallback((pageNumber: number, fraction = 0) => {
    const host = scrollRef.current,
      el = document.getElementById(`page-${pageNumber}`);
    if (host && el)
      host.scrollTo({
        top: el.offsetTop + fraction * el.offsetHeight - 24,
        behavior: "instant",
      });
    setPage(pageNumber);
  }, []);
  useEffect(() => {
    if (!pdfReady || !editionId || screen !== "read") return;
    let cancelled = false;
    const target =
      focusId &&
      marks.find((a) => a.id === focusId && a.editionId === editionId);
    if (target) {
      jump(target.page);
      return;
    }
    api<{ page: number; fraction: number }>(`progress/${editionId}`)
      .then((p) => {
        if (!cancelled) jump(p.page, p.fraction);
      })
      .catch(report);
    return () => {
      cancelled = true;
    };
    // Restore once when a document opens, not on every background note refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfReady, editionId, screen, jump]);
  useEffect(() => {
    if (!focusId || !pdfReady) return;
    const a = marks.find((a) => a.id === focusId && a.editionId === editionId);
    if (a && edition) {
      const bounds = edition.pages[a.page - 1];
      jump(
        a.page,
        Math.max(
          0,
          (bounds[3] - Math.max(...a.rects.map((r) => r[3]))) /
            (bounds[3] - bounds[1]) -
            0.05,
        ),
      );
      history.replaceState(null, "", `/?edition=${editionId}`);
    }
    // Background refresh must not move the user's reading position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, pdfReady, editionId, jump]);
  function keepDraft(value: Draft) {
    setDraft(value);
    setDrafts((previous) => {
      const next = { ...previous, [value.id]: value };
      try {
        localStorage.setItem(draftKey, JSON.stringify(next));
      } catch {
        setMessage("本机无法保存草稿，请保持页面打开并尽快保存到服务器。");
      }
      return next;
    });
  }
  function removeDraft(id: string) {
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[id];
      try {
        localStorage.setItem(draftKey, JSON.stringify(next));
      } catch {}
      return next;
    });
    setDraft(null);
    setConflict(false);
  }
  function openEdition(id: string, annotationId: string | null = null) {
    setEditionId(id);
    setScreen("read");
    setFocusId(annotationId);
    setSelected(false);
    setDraft(null);
    setConflict(false);
    history.replaceState(
      null,
      "",
      `/?edition=${id}${annotationId ? `&annotation=${annotationId}` : ""}`,
    );
  }
  function edit(a: Annotation) {
    setConflict(false);
    keepDraft(drafts[a.id] || a);
    setNotesOpen(true);
    setSelected(false);
  }
  function create(kind: Draft["kind"]) {
    const selection = selectionRef.current;
    if (!selection || !edition) return;
    const value: Draft = {
      ...selection,
      id: crypto.randomUUID(),
      editionId: edition.id,
      kind,
      color: "yellow",
      note: "",
    };
    keepDraft(value);
    setConflict(false);
    setSelected(false);
    window.getSelection()?.removeAllRanges();
    if (kind !== "note") void save(value);
    else setNotesOpen(true);
  }
  async function save(value: Draft) {
    if (busy) return;
    setBusy(true);
    setMessage("正在保存…");
    setConflict(false);
    try {
      const saved = await api<Annotation>(
        `annotations${value.version ? `/${value.id}` : ""}`,
        value.version ? "PATCH" : "POST",
        value,
      );
      setMarks((previous) => [
        ...previous.filter((a) => a.id !== saved.id),
        saved,
      ]);
      removeDraft(value.id);
      setMessage("已保存，将同步到你的其他设备。");
    } catch (error) {
      keepDraft(value);
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      report(
        error instanceof TypeError
          ? new Error("未保存：连接中断，草稿已保留在本机。恢复连接后请重试。")
          : error,
      );
    } finally {
      setBusy(false);
    }
  }
  async function erase(value: Draft) {
    if (!value.version) {
      removeDraft(value.id);
      return;
    }
    setBusy(true);
    try {
      await api(`annotations/${value.id}`, "DELETE", {
        version: value.version,
      });
      removeDraft(value.id);
      setMarks((previous) => previous.filter((a) => a.id !== value.id));
      setMessage("标注已删除。");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function reviewConflict() {
    try {
      const rows = await loadMarks();
      const latest = rows.find((a) => a.id === draft?.id);
      if (!latest) {
        setMessage(
          "服务器上的笔记已删除。你仍可复制草稿内容，或关闭并保留草稿。",
        );
        return;
      }
      setMessage(
        `最新批注：${latest.note || "（没有文字批注）"}。草稿仍保留，确认后可按最新版本保存。`,
      );
      if (draft) keepDraft({ ...draft, version: latest.version });
      setConflict(false);
    } catch (error) {
      report(error);
    }
  }
  function onScroll() {
    if (!pdfReady || !scrollRef.current || !edition) return;
    const host = scrollRef.current;
    const pages = Array.from(host.querySelectorAll<HTMLElement>(".paper-page"));
    const top = host.scrollTop + 40;
    const active =
      pages.find((el) => el.offsetTop + el.offsetHeight > top) || pages.at(-1);
    if (!active) return;
    const pageNumber = Number(active.dataset.page),
      fraction = Math.max(
        0,
        Math.min(1, (top - active.offsetTop) / active.offsetHeight),
      );
    setPage(pageNumber);
    clearTimeout(progressTimer.current);
    const id = edition.id;
    progressTimer.current = setTimeout(() => {
      void api(`progress/${id}`, "POST", { page: pageNumber, fraction }).catch(
        () => {},
      );
    }, 800);
  }
  const visibleMarks = marks.filter(
    (a) =>
      (screen === "notes"
        ? !filter || a.editionId === filter
        : a.editionId === editionId) &&
      `${a.quote}\n${a.note}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  function noteList() {
    return (
      <>
        <label className="search">
          <span>⌕</span>
          <input
            aria-label="搜索笔记"
            placeholder="搜索摘录和想法"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {screen === "notes" && (
          <select
            aria-label="按报刊筛选"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">全部报刊</option>
            {items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        )}
        {visibleMarks.length === 0 && (
          <div className="empty-note">
            <span>✎</span>
            <h3>{query ? "没有找到匹配的笔记" : "把值得记住的，留下来"}</h3>
            <p>选中报纸里的文字，划线、高亮，或写下此刻的想法。</p>
          </div>
        )}
        {visibleMarks.map((a) => (
          <article className="note-card" key={a.id}>
            <div className="note-meta">
              <span>
                {a.kind === "underline"
                  ? "下划线"
                  : a.kind === "note"
                    ? "批注"
                    : "高亮"}{" "}
                · 第 {a.page} 页
              </span>
              <button
                onClick={() => edit(a)}
                aria-label={`编辑笔记 ${a.quote.slice(0, 15)}`}
              >
                编辑
              </button>
            </div>
            <button
              className={`quote ${a.color}`}
              onClick={() => {
                openEdition(a.editionId, a.id);
                setNotesOpen(false);
              }}
            >
              {a.quote}
            </button>
            {a.note && <p className="note-content">{a.note}</p>}
            <small>{items.find((e) => e.id === a.editionId)?.title}</small>
          </article>
        ))}
      </>
    );
  }
  if (signedIn === null)
    return (
      <main className="login-page">
        <div className="brand">
          personal_news<span>私人阅报室</span>
        </div>
        <p>正在打开阅报室…</p>
      </main>
    );
  if (!signedIn)
    return (
      <main className="login-page">
        <div className="login-art">
          <span className="eyebrow">YOUR DAILY PERSPECTIVE</span>
          <h1>
            读世界，
            <br />
            留一点自己的想法。
          </h1>
          <p>
            一份报纸，一段专注的时间。
            <br />
            重要的句子，值得再读一次。
          </p>
          <div className="paper-emblem">
            阅<span>PRIVATE EDITION · 个人珍藏</span>
          </div>
        </div>
        <form
          className="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("login", "POST", { username, password });
              const session = await api<{ owner: boolean }>('session');
              if (!session.owner) { window.location.replace('/personal'); return; }
              setSignedIn(true);
              setPassword("");
              setMessage("");
            } catch (error) {
              report(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="brand">
            personal_news<span>私人阅报室</span>
          </div>
          <h2>欢迎回来</h2>
          <p>登录后，在电脑与手机之间继续阅读。</p>
          <a href="/personal">定制我的新闻算法 · 注册 / 登录 →</a>
          <label>
            用户名
            <input
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "正在登录…" : "进入阅报室 →"}
          </button>
          {message && (
            <p className="form-error" role="alert">
              {message}
            </p>
          )}
        </form>
      </main>
    );
  return (
    <div className="app-shell">
      <header className="masthead">
        <button
          className="brand"
          onClick={() => items[0] && openEdition(items[0].id)}
        >
          personal_news<span>私人阅报室</span>
        </button>
        <nav aria-label="主导航">
          <a href="/personal" style={{ alignSelf: 'center', fontSize: 12 }}>我的新闻算法</a>
          <button
            className={screen === "read" ? "active" : ""}
            onClick={() => items[0] && openEdition(items[0].id)}
          >
            最新一期
          </button>
          <button
            className={screen === "archive" ? "active" : ""}
            onClick={() => setScreen("archive")}
          >
            往期报刊
          </button>
          <button
            className={screen === "notes" ? "active" : ""}
            onClick={() => setScreen("notes")}
          >
            我的笔记 <span className="count">{marks.length}</span>
          </button>
        </nav>
        <button
          className="logout"
          onClick={async () => {
            try {
              await api("logout", "POST", {});
              setSignedIn(false);
              setDraft(null);
              setMessage("");
            } catch (error) {
              report(error);
            }
          }}
        >
          退出
        </button>
      </header>
      {!online && (
        <div className="offline" role="status">
          网络已断开。未提交的笔记草稿保留在本机，联网后可重试。
        </div>
      )}
      {screen === "read" && edition && (
        <>
          <div className="reading-toolbar">
            <div className="edition-caption">
              <span className="eyebrow">THE READING ROOM</span>
              <h1>{edition.title}</h1>
            </div>
            <div className="reader-controls">
              <button onClick={() => setScreen('archive')}>选择时间区间</button>
              <label>
                页码{" "}
                <select
                  aria-label="页码"
                  value={page}
                  onChange={(e) => jump(Number(e.target.value))}
                >
                  {edition.pages.map((_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1} / {edition.pages.length}
                    </option>
                  ))}
                </select>
              </label>
              <button
                aria-label="缩小"
                onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
              >
                −
              </button>
              <button onClick={() => setZoom(1)} title="适合宽度">
                {Math.round(zoom * 100)}%
              </button>
              <button
                aria-label="放大"
                onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
              >
                ＋
              </button>
              <button
                className={notesOpen ? "active-tool" : ""}
                onClick={() => setNotesOpen((v) => !v)}
              >
                笔记 <span className="count">{current.length}</span>
              </button>
            </div>
          </div>
          <div className={`reading-layout ${notesOpen ? "with-notes" : ""}`}>
            <div className="reader-scroll" ref={scrollRef} onScroll={onScroll}>
              <PdfDocument
                edition={edition}
                width={width * zoom}
                annotations={current}
                focusedId={focusId}
                onSelect={(selection) => {
                  selectionRef.current = selection;
                  setSelected(true);
                }}
                onEdit={edit}
                onError={setMessage}
                onReady={() => setPdfReady(true)}
              />
              <div className="reading-end">
                本期完 · 好的阅读，留下自己的思考
              </div>
            </div>
            {notesOpen && (
              <aside className="notes-sidebar">
                <div className="section-heading">
                  <h2>
                    本期笔记 <span>{current.length}</span>
                  </h2>
                  <button
                    aria-label="关闭笔记面板"
                    onClick={() => setNotesOpen(false)}
                  >
                    ×
                  </button>
                </div>
                {noteList()}
              </aside>
            )}
          </div>
        </>
      )}
      {screen === "read" && !edition && (
        <div className="empty-state">
          <h1>你的第一份报纸，即将开始</h1>
          <p>报刊导入后，会出现在这里。</p>
        </div>
      )}
      {screen === "archive" && (
        <main className="collection">
          <span className="eyebrow">THE ARCHIVE</span>
          <h1>往期报刊</h1>
          <p className="intro">翻开旧报纸，也翻开当时的思考。</p>
          <PeriodPicker value={periodChoice} onChange={setPeriodChoice} />
          <p className="intro">按期刊日期筛选，共 {visibleEditions.length} 期。多日合刊按结束日期归档，PDF 内容保持整期。</p>
          {!visibleEditions.length && <div className="empty-state" role="status"><h2>这个区间还没有报刊</h2><p>可以扩大时间区间，或查看全部已导入报刊。</p><button onClick={() => setPeriodChoice({ kind: 'all' })}>查看全部报刊</button></div>}
          <div className="edition-grid">
            {visibleEditions.map((e) => (
              <button
                className="edition-card"
                key={e.id}
                onClick={() => openEdition(e.id)}
              >
                <div className="edition-cover">
                  <span>PERSONAL NEWS</span>
                  <strong>AI 观察报</strong>
                  <div className="cover-rule" />
                  <em>{e.title}</em>
                  <div className="cover-lines" />
                  <small>
                    {e.date} · {e.pages.length} 版
                  </small>
                </div>
                <div className="edition-card-meta">
                  <strong>{e.title}</strong>
                  <span>
                    {e.id === items[0]?.id ? "最新一期 · " : ""}
                    {marks.filter((a) => a.editionId === e.id).length} 条笔记 ·
                    版本 {e.hash.slice(0, 6)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </main>
      )}
      {screen === "notes" && (
        <main className="collection notes-collection">
          <span className="eyebrow">YOUR MARGINALIA</span>
          <h1>我的笔记</h1>
          <p className="intro">读过的内容，成为自己的想法。</p>
          <div className="all-notes">{noteList()}</div>
        </main>
      )}
      {selected && screen === "read" && (
        <div
          className="selection-tools"
          role="toolbar"
          aria-label="选中文字操作"
          onMouseDown={(e) => e.preventDefault()}
        >
          <span>选中文字</span>
          <button onClick={() => create("highlight")}>▰ 高亮</button>
          <button onClick={() => create("underline")}>U 划线</button>
          <button onClick={() => create("note")}>✎ 写笔记</button>
          <button
            aria-label="取消选择"
            onClick={() => {
              setSelected(false);
              window.getSelection()?.removeAllRanges();
            }}
          >
            ×
          </button>
        </div>
      )}
      {Object.keys(drafts).length > 0 && !draft && (
        <details className="draft-tray">
          <summary>本机草稿 · {Object.keys(drafts).length}</summary>
          {Object.values(drafts).map((d) => (
            <button
              key={d.id}
              onClick={() => {
                setDraft(d);
                setConflict(false);
              }}
            >
              {d.quote.slice(0, 28)}…
            </button>
          ))}
        </details>
      )}
      {draft && (
        <div className="editor-backdrop">
          <section
            className="note-editor"
            role="dialog"
            aria-modal="true"
            aria-label="编辑笔记"
          >
            <div className="section-heading">
              <h2>{draft.version ? "编辑笔记" : "留下你的想法"}</h2>
              <button
                aria-label="关闭并保留草稿"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setConflict(false);
                }}
              >
                ×
              </button>
            </div>
            <blockquote>{draft.quote}</blockquote>
            <div className="editor-options">
              <label>
                标注方式
                <select
                  aria-label="标注方式"
                  value={draft.kind}
                  disabled={busy}
                  onChange={(e) =>
                    keepDraft({
                      ...draft,
                      kind: e.target.value as Draft["kind"],
                    })
                  }
                >
                  <option value="highlight">高亮</option>
                  <option value="underline">下划线</option>
                  <option value="note">批注</option>
                </select>
              </label>
              <div className="color-picker" aria-label="标注颜色">
                {Object.entries(colorLabels).map(([color, label]) => (
                  <button
                    key={color}
                    aria-label={label}
                    aria-pressed={draft.color === color}
                    className={`swatch ${color}`}
                    disabled={busy}
                    onClick={() =>
                      keepDraft({ ...draft, color: color as Draft["color"] })
                    }
                  />
                ))}
              </div>
            </div>
            <label>
              我的想法
              <textarea
                aria-label="我的想法"
                maxLength={10000}
                placeholder="这段内容，让你想到了什么？"
                value={draft.note}
                disabled={busy}
                onChange={(e) => keepDraft({ ...draft, note: e.target.value })}
              />
            </label>
            <p className="draft-hint">
              草稿保留在此浏览器，点击保存后才会同步。
            </p>
            {conflict && (
              <button
                className="conflict"
                disabled={busy}
                onClick={reviewConflict}
              >
                查看服务器最新版本，保留我的草稿
              </button>
            )}
            <div className="editor-actions">
              <button
                className="danger"
                disabled={busy || conflict}
                onClick={() => erase(draft)}
              >
                {draft.version ? "删除标注" : "丢弃草稿"}
              </button>
              <button
                className="primary"
                disabled={busy || conflict}
                onClick={() => save(draft)}
              >
                {busy ? "正在保存…" : "保存笔记"}
              </button>
            </div>
            <p className="editor-status" role="status">
              {message}
            </p>
          </section>
        </div>
      )}
      {message && !draft && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button aria-label="关闭提示" onClick={() => setMessage("")}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
