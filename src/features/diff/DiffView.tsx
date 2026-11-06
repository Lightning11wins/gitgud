import { FoldIcon, SidebarCollapseIcon, SidebarExpandIcon, UnfoldIcon } from "@primer/octicons-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router";
import type { ReviewThread } from "@/api/types";
import { Spinner } from "@/components/Spinner";
import type { DiffSource, ViewedMap } from "./data";
import { FileDiff, fileDomId, type PullContext } from "./FileDiff";
import { FileTree, buildTree, treeOrder } from "./FileTree";
import type { DiffFile } from "./model";
import "./diff.css";

export interface DiffViewProps {
  files: DiffFile[];
  source: DiffSource;
  pull?: PullContext;
  threads?: ReviewThread[];
  viewed?: ViewedMap;
  onSetViewed?: (paths: string[], viewed: boolean) => void;
  fetching?: boolean;
  /** Shown above the toolbar, e.g. a truncation warning. */
  notice?: string;
}

const EMPTY: ReviewThread[] = [];
const TREE_WIDTH_KEY = "gitgud-tree-width";

function readTreeWidth(): number {
  try {
    return Number(localStorage.getItem(TREE_WIDTH_KEY)) || 300;
  } catch {
    return 300;
  }
}

/** Bottom of the app and PR headers that stick above the diff. */
function stickyTop(): number {
  const appHeader = document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
  const pullSticky = document.querySelector(".pull-sticky")?.getBoundingClientRect().bottom ?? 0;
  return Math.max(appHeader, pullSticky, 0);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

/** Split diff of many files with a file tree, viewed state, and inline review threads. */
export function DiffView({ files, source, pull, threads, viewed, onSetViewed, fetching, notice }: DiffViewProps) {
  const [params, setParams] = useSearchParams();
  const ignoreWs = params.get("w") === "1";
  const root = useMemo(() => buildTree(files), [files]);
  const ordered = useMemo(() => treeOrder(root), [root]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(true);
  const [treeWidth, setTreeWidth] = useState(readTreeWidth);
  const rootRef = useRef<HTMLDivElement>(null);

  const viewedRef = useRef(viewed);
  viewedRef.current = viewed;
  const isCollapsed = (path: string) => overrides[path] ?? viewed?.[path] === "VIEWED";

  // Per-file thread arrays keep their identity while their threads are unchanged, so only touched files re-render.
  const prevThreads = useRef(new Map<string, ReviewThread[]>());
  const threadsByPath = useMemo(() => {
    const next = new Map<string, ReviewThread[]>();
    for (const t of threads ?? []) {
      const list = next.get(t.path);
      if (list) list.push(t);
      else next.set(t.path, [t]);
    }
    for (const [path, list] of next) {
      const old = prevThreads.current.get(path);
      if (old && old.length === list.length && old.every((t, i) => t === list[i])) next.set(path, old);
    }
    prevThreads.current = next;
    return next;
  }, [threads]);
  const commentCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const [path, list] of threadsByPath) m.set(path, list.reduce((n, t) => n + t.comments.nodes.length, 0));
    return m;
  }, [threadsByPath]);

  const totals = useMemo(() => ordered.reduce((a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }), { add: 0, del: 0 }), [ordered]);
  const viewedCount = viewed ? ordered.filter((f) => viewed[f.filename] === "VIEWED").length : 0;

  const scrollToFile = useCallback((path: string) => {
    const el = document.getElementById(fileDomId(path));
    if (!el) return;
    const align = () => {
      const bar = rootRef.current?.querySelector(".dv-toolbar")?.getBoundingClientRect().height ?? 0;
      window.scrollBy(0, el.getBoundingClientRect().top - stickyTop() - bar);
    };
    align();
    // Sticky headers and content-visibility sizes above the target settle after scrolling; align again.
    requestAnimationFrame(() => requestAnimationFrame(align));
    setActive(path);
  }, []);

  const onToggleCollapsed = useCallback(
    (path: string) => setOverrides((o) => ({ ...o, [path]: !(o[path] ?? viewedRef.current?.[path] === "VIEWED") })),
    [],
  );

  const onToggleViewed = useCallback(
    (path: string) => {
      const now = viewedRef.current?.[path] === "VIEWED";
      setOverrides((o) => {
        const { [path]: _, ...rest } = o;
        return rest;
      });
      onSetViewed?.([path], !now);
      if (!now) {
        const el = document.getElementById(fileDomId(path));
        const top = rootRef.current?.querySelector(".dv-toolbar")?.getBoundingClientRect().bottom ?? 0;
        if (el && el.getBoundingClientRect().top < top) requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
      }
    },
    [onSetViewed],
  );

  // Tracks the file at the top of the viewport and the height of sticky headers above the diff.
  useEffect(() => {
    let raf = 0;
    let lastTop = -1;
    const update = () => {
      raf = 0;
      const rootEl = rootRef.current;
      if (!rootEl || rootEl.offsetParent === null) return;
      const top = stickyTop();
      if (top !== lastTop) {
        lastTop = top;
        rootEl.style.setProperty("--dv-top", `${top}px`);
      }
      const toolbar = rootEl.querySelector(".dv-toolbar")?.getBoundingClientRect().bottom ?? top;
      const sections = rootEl.querySelectorAll<HTMLElement>("section.df");
      let lo = 0;
      let hi = sections.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sections[mid].getBoundingClientRect().top <= toolbar + 8) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      const path = sections[Math.max(0, found)]?.dataset.path ?? null;
      setActive((prev) => (prev === path ? prev : path));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // n/p next/previous file, v toggles viewed for the current file.
  const keyState = useRef({ ordered, active, onToggleViewed, scrollToFile });
  keyState.current = { ordered, active, onToggleViewed, scrollToFile };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (rootRef.current?.offsetParent == null) return;
      const { ordered, active, onToggleViewed, scrollToFile } = keyState.current;
      const i = ordered.findIndex((f) => f.filename === active);
      if (e.key === "n" || e.key === "p") {
        const next = ordered[Math.max(0, Math.min(ordered.length - 1, i + (e.key === "n" ? 1 : -1)))];
        if (next) scrollToFile(next.filename);
      } else if (e.key === "v" && pull && active) onToggleViewed(active);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pull]);

  const startResize = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startW = treeWidth;
    const move = (ev: PointerEvent) => setTreeWidth(Math.max(180, Math.min(600, startW + ev.clientX - startX)));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(TREE_WIDTH_KEY, String(Math.max(180, Math.min(600, startW + ev.clientX - startX))));
      } catch {
        // Storage blocked; the width lasts for this session.
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const allCollapsed = ordered.length > 0 && ordered.every((f) => isCollapsed(f.filename));
  const setAll = (collapsed: boolean) => setOverrides(Object.fromEntries(ordered.map((f) => [f.filename, collapsed])));

  return (
    <div className="dv" ref={rootRef} style={{ "--tree-w": `${treeWidth}px` } as CSSProperties}>
      {notice && <div className="flash warn" style={{ marginBottom: 8 }}>{notice}</div>}
      <div className="dv-toolbar">
        <button className="btn invisible sm icon" onClick={() => setShowTree((s) => !s)} title={showTree ? "Hide file tree" : "Show file tree"} aria-label={showTree ? "Hide file tree" : "Show file tree"}>
          {showTree ? <SidebarExpandIcon /> : <SidebarCollapseIcon />}
        </button>
        <span>
          <strong>{ordered.length.toLocaleString()}</strong> {ordered.length === 1 ? "file" : "files"}
        </span>
        <span className="diffstat">
          <span className="add">+{totals.add.toLocaleString()}</span> <span className="del">-{totals.del.toLocaleString()}</span>
        </span>
        {fetching && <Spinner size={14} />}
        <span className="grow" />
        <label className="row dv-ws" title="Hide whitespace-only changes">
          <input
            type="checkbox"
            checked={ignoreWs}
            onChange={(e) =>
              setParams(
                (p) => {
                  const next = new URLSearchParams(p);
                  if (e.target.checked) next.set("w", "1");
                  else next.delete("w");
                  return next;
                },
                { replace: true },
              )
            }
          />
          Hide whitespace
        </label>
        <button className="btn sm" onClick={() => setAll(!allCollapsed)}>
          {allCollapsed ? <UnfoldIcon /> : <FoldIcon />}
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
        {viewed && (
          <span className="dv-viewed" title="Files you've marked as viewed">
            <progress max={ordered.length} value={viewedCount} />
            {viewedCount} / {ordered.length} files viewed
          </span>
        )}
      </div>
      <div className="dv-body">
        {showTree && (
          <aside className="dv-tree">
            <FileTree root={root} active={active} viewed={viewed} comments={commentCounts} onSelect={scrollToFile} />
            <div className="dv-resize" onPointerDown={startResize} title="Drag to resize" />
          </aside>
        )}
        <div className="dv-files">
          {ordered.length === 0 && <div className="blankslate">No files changed.</div>}
          {ordered.map((f) => (
            <FileDiff
              key={f.filename}
              file={f}
              source={source}
              pull={pull}
              threads={threadsByPath.get(f.filename) ?? EMPTY}
              collapsed={isCollapsed(f.filename)}
              viewed={viewed ? viewed[f.filename] === "VIEWED" : undefined}
              ignoreWs={ignoreWs}
              onToggleCollapsed={onToggleCollapsed}
              onToggleViewed={viewed && onSetViewed ? onToggleViewed : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
