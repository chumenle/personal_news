"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import type { Annotation, Box, Draft, Edition } from "@/lib/types";
import "pdfjs-dist/web/pdf_viewer.css";

export const colors = {
  yellow: "#f7d85b",
  green: "#90c7a3",
  blue: "#85b9e3",
  pink: "#e6a7ba",
};
type Selection = Pick<Draft, "quote" | "rects" | "page">;
export default function PdfDocument({
  edition,
  width,
  annotations,
  onSelect,
  onEdit,
  onError,
  onReady,
  focusedId,
}: {
  edition: Edition;
  width: number;
  annotations: Annotation[];
  onSelect: (s: Selection) => void;
  onEdit: (a: Annotation) => void;
  onError: (s: string) => void;
  onReady: () => void;
  focusedId: string | null;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    let cancelled = false;
    let task:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    setPdf(null);
    (async () => {
      const engine = await import("pdfjs-dist");
      if (cancelled) return;
      engine.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      task = engine.getDocument({
        url: `/api/pdf/${edition.id}`,
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        wasmUrl: "/pdfjs/wasm/",
      });
      const doc = await task.promise;
      if (!cancelled) {
        setPdf(doc);
        ready.current();
      }
    })().catch((error) => {
      if (!cancelled)
        errorHandler.current(
          `报刊加载失败，请刷新或重新登录。${error?.name === "PasswordException" ? " 暂不支持加密 PDF。" : ""}`,
        );
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [edition.id]);
  return (
    <div className="pdf-stack" style={{ width }} aria-label="报刊正文">
      {!pdf && <div className="loading-paper">正在打开报刊…</div>}
      {edition.pages.map((_, i) => (
        <PdfPage
          key={`${edition.id}-${i}`}
          pdf={pdf}
          pageNumber={i + 1}
          width={width}
          bounds={edition.pages[i]}
          annotations={annotations.filter((a) => a.page === i + 1)}
          onSelect={onSelect}
          onEdit={onEdit}
          onError={onError}
          focusedId={focusedId}
        />
      ))}
    </div>
  );
}
function PdfPage({
  pdf,
  pageNumber,
  width,
  bounds,
  annotations,
  onSelect,
  onEdit,
  onError,
  focusedId,
}: {
  pdf: PDFDocumentProxy | null;
  pageNumber: number;
  width: number;
  bounds: Box;
  annotations: Annotation[];
  onSelect: (s: Selection) => void;
  onEdit: (a: Annotation) => void;
  onError: (s: string) => void;
  focusedId: string | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    paint = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [near, setNear] = useState(false);
  const [links, setLinks] = useState<{ id: string; url: string; rect: Box }[]>(
    [],
  );
  const pageRef = useRef<PDFPageProxy | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { root: host.current?.closest(".reader-scroll"), rootMargin: "1200px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !near) return;
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy["render"]> | undefined;
    let textLayer: import("pdfjs-dist").TextLayer | undefined;
    (async () => {
      const page = await pdf.getPage(pageNumber);
      const engine = await import("pdfjs-dist");
      if (cancelled || !paint.current) return;
      pageRef.current = page;
      const annotations = await page.getAnnotations();
      if (cancelled) return;
      setLinks(
        annotations
          .filter(
            (a) => typeof a.url === "string" && /^https?:\/\//i.test(a.url),
          )
          .map((a) => ({ id: a.id, url: a.url, rect: a.rect as Box })),
      );
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: width / base.width });
      setViewport(vp);
      const canvas = document.createElement("canvas");
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(vp.width * ratio);
      canvas.height = Math.floor(vp.height * ratio);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      canvas.setAttribute("aria-hidden", "true");
      const text = document.createElement("div");
      text.className = "textLayer";
      text.style.setProperty("--scale-factor", String(vp.scale));
      text.style.setProperty("--total-scale-factor", String(vp.scale));
      paint.current.replaceChildren(canvas, text);
      renderTask = page.render({
        canvas,
        viewport: vp,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      textLayer = new engine.TextLayer({
        textContentSource: page.streamTextContent(),
        container: text,
        viewport: vp,
      });
      await Promise.all([renderTask.promise, textLayer.render()]);
      if (!cancelled && host.current) host.current.dataset.rendered = "true";
    })().catch((error) => {
      if (!cancelled && error?.name !== "RenderingCancelledException")
        onErrorRef.current("这一页加载失败，请刷新重试。");
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, pageNumber, width, near]);
  useEffect(() => () => clearTimeout(selectionTimer.current), []);
  const selectionHandler = useRef(() => {});
  selectionHandler.current = readSelection;
  useEffect(() => {
    const changed = () => {
      clearTimeout(selectionTimer.current);
      selectionTimer.current = setTimeout(
        () => selectionHandler.current(),
        300,
      );
    };
    document.addEventListener("selectionchange", changed);
    return () => {
      document.removeEventListener("selectionchange", changed);
      clearTimeout(selectionTimer.current);
    };
  }, []);
  function readSelection() {
    const selection = window.getSelection();
    if (
      !selection?.rangeCount ||
      selection.isCollapsed ||
      !host.current ||
      !viewport
    )
      return;
    const range = selection.getRangeAt(0);
    if (
      !host.current.contains(range.startContainer) &&
      !host.current.contains(range.endContainer)
    )
      return;
    if (
      !host.current.contains(range.startContainer) ||
      !host.current.contains(range.endContainer)
    ) {
      onError("请在同一页内选中文字；跨页内容可分别标注。");
      return;
    }
    const layer = host.current.querySelector(".textLayer");
    if (
      !layer?.contains(range.startContainer) ||
      !layer.contains(range.endContainer)
    )
      return;
    const pageBox = host.current.getBoundingClientRect();
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const rects: Box[] = [];
    let node: Node | null;
    // Intersect each selected text node separately; a union bounding box would
    // incorrectly paint gutters and adjacent columns in newspaper layouts.
    while ((node = walker.nextNode())) {
      if (!range.intersectsNode(node) || !node.textContent?.trim()) continue;
      const part = document.createRange();
      part.setStart(
        node,
        node === range.startContainer ? range.startOffset : 0,
      );
      part.setEnd(
        node,
        node === range.endContainer ? range.endOffset : node.textContent.length,
      );
      for (const r of Array.from(part.getClientRects())) {
        if (r.width < 0.5 || r.height < 0.5) continue;
        const a = viewport.convertToPdfPoint(
          r.left - pageBox.left,
          r.top - pageBox.top,
        );
        const b = viewport.convertToPdfPoint(
          r.right - pageBox.left,
          r.bottom - pageBox.top,
        );
        const x1 = Math.max(bounds[0], Math.min(a[0], b[0])),
          y1 = Math.max(bounds[1], Math.min(a[1], b[1]));
        const x2 = Math.min(bounds[2], Math.max(a[0], b[0])),
          y2 = Math.min(bounds[3], Math.max(a[1], b[1]));
        if (x2 > x1 && y2 > y1) rects.push([x1, y1, x2, y2]);
      }
    }
    const quote = selection.toString().trim();
    if (quote && rects.length) onSelect({ quote, rects, page: pageNumber });
  }
  function click(e: React.MouseEvent) {
    if (!viewport || !host.current || !window.getSelection()?.isCollapsed)
      return;
    const box = host.current.getBoundingClientRect();
    const [x, y] = viewport.convertToPdfPoint(
      e.clientX - box.left,
      e.clientY - box.top,
    );
    const hit = annotations.find((a) =>
      a.rects.some((r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]),
    );
    if (hit) onEdit(hit);
  }
  return (
    <section
      className="paper-page"
      ref={host}
      id={`page-${pageNumber}`}
      data-page={pageNumber}
      style={{
        width,
        height:
          viewport?.height ||
          (width * (bounds[3] - bounds[1])) / (bounds[2] - bounds[0]),
      }}
      aria-label={`第 ${pageNumber} 页`}
      onMouseUp={readSelection}
      onKeyUp={readSelection}
      onTouchEnd={() => {
        clearTimeout(selectionTimer.current);
        selectionTimer.current = setTimeout(readSelection, 350);
      }}
      onClick={click}
    >
      <div ref={paint} className="page-paint" />
      <div className="annotation-layer" aria-hidden="true">
        {viewport &&
          annotations.flatMap((a) =>
            a.rects.map((r, i) => {
              const v = [
                ...viewport.convertToViewportPoint(r[0], r[1]),
                ...viewport.convertToViewportPoint(r[2], r[3]),
              ];
              return (
                <span
                  key={`${a.id}-${i}`}
                  data-annotation={a.id}
                  className={`annotation ${a.kind} ${focusedId === a.id ? "focused" : ""}`}
                  style={
                    {
                      left: Math.min(v[0], v[2]),
                      top: Math.min(v[1], v[3]),
                      width: Math.abs(v[2] - v[0]),
                      height: Math.abs(v[3] - v[1]),
                      "--mark-color": colors[a.color],
                    } as React.CSSProperties
                  }
                />
              );
            }),
          )}
      </div>
      {viewport &&
        links.map((link) => {
          const a = viewport.convertToViewportPoint(link.rect[0], link.rect[1]),
            b = viewport.convertToViewportPoint(link.rect[2], link.rect[3]);
          return (
            <a
              key={link.id}
              className="pdf-source-link"
              aria-label="打开这条来源"
              title={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                left: Math.min(a[0], b[0]),
                top: Math.min(a[1], b[1]),
                width: Math.abs(b[0] - a[0]),
                height: Math.abs(b[1] - a[1]),
              }}
            />
          );
        })}
      <span className="page-number">{String(pageNumber).padStart(2, "0")}</span>
    </section>
  );
}
