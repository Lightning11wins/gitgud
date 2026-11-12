import { FoldIcon, SidebarCollapseIcon, SidebarExpandIcon, UnfoldIcon, XIcon } from "@primer/octicons-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router";
import type { ReviewThread } from "@/api/types";
import { Spinner } from "@/components/Spinner";
import { useHotkey } from "@/lib/hotkeys";
import type { DiffSource, ViewedMap } from "./data";
import { FileDiff, ROW_H, fileDomId, type PullContext } from "./FileDiff";
import { FileTree, buildTree, treeOrder } from "./FileTree";
import type { DiffFile } from "./model";
import "./diff.css";
import { tooltip } from "@/lib/tooltip";

export interface DiffViewProps {
  files: DiffFile[];
  source: DiffSource;
  pull?: PullContext;
  threads?: ReviewThread[];
  viewed?: ViewedMap;
  onSetViewed?: (paths: string[], viewed: boolean) => void;
  /** The last failed viewed toggle, shown in the toolbar until dismissed. */
  viewedError?: unknown;
  onDismissViewedError?: () => void;
  fetching?: boolean;
  /** Shown above the toolbar, e.g. a truncation warning. */
  notice?: string;
}

const EMPTY: ReviewThread[] = [];
const TREE_WIDTH_KEY = "gitgud-tree-width";
const TREE_SHOWN_KEY = "gitgud-tree-shown";
/** Viewports narrower than this hide the file tree until the user shows it. */
const WIDE_QUERY = "(min-width: 1280px)";

function readTreeWidth(): number {
  try {
    return Number(localStorage.getItem(TREE_WIDTH_KEY)) || 300;
  } catch {
    return 300;
  }
}

/** The user's last explicit tree toggle, or null if they never toggled it. */
function readTreeShown(): boolean | null {
  try {
    const v = localStorage.getItem(TREE_SHOWN_KEY);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

function useWide(): boolean {
  const [wide, setWide] = useState(() => matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** Bottom of the app and PR headers that stick above the diff. */
function stickyTop(): number {
  const appHeader = document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0;
  const pullSticky = document.querySelector(".pull-sticky")?.getBoundingClientRect().bottom ?? 0;
  return Math.max(appHeader, pullSticky, 0);
}

/** Split diff of many files with a file tree, viewed state, and inline review threads. */
export function DiffView({ files, source, pull, threads, viewed, onSetViewed, viewedError, onDismissViewedError, fetching, notice }: DiffViewProps) {
  const [params, setParams] = useSearchParams();
  const ignoreWs = params.get("w") === "1";
  const root = useMemo(() => buildTree(files), [files]);
  const ordered = useMemo(() => treeOrder(root), [root]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string | null>(null);
  const [treeShown, setTreeShown] = useState(readTreeShown);
  const wide = useWide();
  const showTree = treeShown ?? wide;
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
  const stepFile = (d: 1 | -1) => {
    const i = ordered.findIndex((f) => f.filename === active);
    const next = ordered[Math.max(0, Math.min(ordered.length - 1, i + d))];
    if (next) scrollToFile(next.filename);
  };
  useHotkey("n", () => stepFile(1));
  useHotkey("p", () => stepFile(-1));
  useHotkey("v", () => active && onToggleViewed(active), !!viewed && !!onSetViewed);

  // j/k next/previous change block, placed one row below the sticky toolbar and file header.
  const blockAlign = useRef(0);
  useEffect(() => () => cancelAnimationFrame(blockAlign.current), []);
  const stepBlock = (d: 1 | -1) => {
    const rootEl = rootRef.current;
    if (!rootEl) return;
    const bar = rootEl.querySelector(".dv-toolbar")?.getBoundingClientRect().height ?? 0;
    const head = rootEl.querySelector(".df-head")?.getBoundingClientRect().height ?? 0;
    const anchorAt = () => stickyTop() + bar + head + ROW_H;
    const anchor = anchorAt();
    // Unmounted chunks are placeholders of fixed-height rows; mounted ones mark block starts with data-blk.
    const tops = (el: HTMLElement) =>
      el.classList.contains("dk-ph")
        ? el.dataset.blocks!.split(",").map((i) => el.getBoundingClientRect().top + Number(i) * ROW_H)
        : [...el.querySelectorAll("[data-blk]")].map((c) => c.getBoundingClientRect().top);
    const chunks = [...rootEl.querySelectorAll<HTMLElement>(".dv-files .df:not(.collapsed) [data-blocks]")];
    let target: { el: HTMLElement; k: number } | null = null;
    for (let c = d === 1 ? 0 : chunks.length - 1; !target && c >= 0 && c < chunks.length; c += d) {
      const el = chunks[c];
      const box = el.getBoundingClientRect();
      if (d === 1 ? box.bottom <= anchor + 1 : box.top >= anchor - 1) continue;
      const t = tops(el);
      const k = d === 1 ? t.findIndex((y) => y > anchor + 1) : t.findLastIndex((y) => y < anchor - 1);
      if (k >= 0) target = { el, k };
    }
    if (!target) return;
    const { el, k } = target;
    const align = () => {
      const y = tops(el)[k];
      if (y !== undefined) window.scrollBy(0, y - anchorAt());
    };
    align();
    // The chunk mounts once near the viewport and sizes around it settle; keep aligning for a few frames.
    cancelAnimationFrame(blockAlign.current);
    let frames = 0;
    const tick = () => {
      align();
      if (++frames < 8) blockAlign.current = requestAnimationFrame(tick);
    };
    blockAlign.current = requestAnimationFrame(tick);
  };
  useHotkey("j", () => stepBlock(1));
  useHotkey("k", () => stepBlock(-1));

  const stopResize = useRef<(() => void) | null>(null);
  useEffect(() => () => stopResize.current?.(), []);
  const startResize = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startW = treeWidth;
    const move = (ev: PointerEvent) => setTreeWidth(Math.max(180, Math.min(600, startW + ev.clientX - startX)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      stopResize.current = null;
    };
    const up = (ev: PointerEvent) => {
      stop();
      try {
        localStorage.setItem(TREE_WIDTH_KEY, String(Math.max(180, Math.min(600, startW + ev.clientX - startX))));
      } catch {
        // Storage blocked; the width lasts for this session.
      }
    };
    stopResize.current?.();
    stopResize.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const toggleTree = (shown: boolean) => {
    setTreeShown(shown);
    try {
      localStorage.setItem(TREE_SHOWN_KEY, shown ? "1" : "0");
    } catch {
      // Storage blocked; the choice lasts for this session.
    }
  };

  const allCollapsed = ordered.length > 0 && ordered.every((f) => isCollapsed(f.filename));
  const setAll = (collapsed: boolean) => setOverrides(Object.fromEntries(ordered.map((f) => [f.filename, collapsed])));

  return (
    <div className="dv" ref={rootRef} style={{ "--tree-w": `${treeWidth}px` } as CSSProperties}>
      {notice && <div className="flash warn" style={{ marginBottom: 8 }}>{notice}</div>}
      <div className="dv-toolbar">
        <button className="btn invisible sm icon" onClick={() => toggleTree(!showTree)} {...tooltip(showTree ? "Hide file tree" : "Show file tree", "label")}>
          {showTree ? <SidebarExpandIcon /> : <SidebarCollapseIcon />}
        </button>
        <span>
          <strong>{ordered.length.toLocaleString()}</strong> {ordered.length === 1 ? "file" : "files"}
        </span>
        <span className="diffstat">
          <span className="add">+{totals.add.toLocaleString()}</span> <span className="del">-{totals.del.toLocaleString()}</span>
        </span>
        {fetching && <Spinner label="Checking for new changes" />}
        <span className="grow" />
        {viewedError != null && (
          <span className="flash error row dv-flash" role="alert">
            <span className="truncate">{viewedError instanceof Error ? viewedError.message : String(viewedError)}</span>
            {onDismissViewedError && (
              <button className="btn invisible xs icon" aria-label="Dismiss" onClick={onDismissViewedError}>
                <XIcon />
              </button>
            )}
          </span>
        )}
        <label className="row dv-ws" {...tooltip("Hide whitespace-only changes")}>
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
        <button className="btn sm" onClick={() => setAll(!allCollapsed)} aria-label={allCollapsed ? "Expand all" : "Collapse all"}>
          {allCollapsed ? <UnfoldIcon /> : <FoldIcon />}
          <span className="dv-wide">{allCollapsed ? "Expand all" : "Collapse all"}</span>
        </button>
        {viewed && (
          <span className="dv-viewed" {...tooltip("Files you've marked as viewed")}>
            <progress max={ordered.length} value={viewedCount} />
            {viewedCount} / {ordered.length}
            <span className="dv-wide"> files viewed</span>
          </span>
        )}
      </div>
      <div className="dv-body">
        {showTree && (
          <aside className="dv-tree">
            <FileTree root={root} active={active} viewed={viewed} comments={commentCounts} onSelect={scrollToFile} />
            <div className="dv-resize" onPointerDown={startResize} {...tooltip("Drag to resize")} />
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
