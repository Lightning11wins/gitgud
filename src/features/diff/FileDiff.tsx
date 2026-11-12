import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CommentIcon,
  CopyIcon,
  FoldDownIcon,
  FoldUpIcon,
  KebabHorizontalIcon,
  UnfoldIcon,
} from "@primer/octicons-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReviewThread } from "@/api/types";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Spinner } from "@/components/Spinner";
import { NewThreadForm } from "@/features/review/NewThreadForm";
import { ReviewThreadView } from "@/features/review/ReviewThread";
import { fetchContent, type DiffSource } from "./data";
import { PRI_IDLE, PRI_VISIBLE, useTokens, type Tokens } from "./highlight";
import { languageFor } from "./lang";
import {
  CTX,
  DEL,
  buildRows,
  diffContents,
  expandGap,
  hiddenReason,
  ignoreWhitespace,
  isBinaryText,
  parsePatch,
  sideLines,
  splitLines,
  wordRanges,
  type Cell,
  type DiffFile,
  type GapExpansion,
  type Hunk,
  type Row,
} from "./model";
import { useNear, useScheduled } from "./schedule";
import { copyText } from "@/lib/clipboard";
import { tooltip } from "@/lib/tooltip";

export interface PullContext {
  owner: string;
  repo: string;
  number: number;
  pullId: string;
  /** Head commit the diff shows; new comments are placed against it. */
  head: string;
}

export interface FileDiffProps {
  file: DiffFile;
  source: DiffSource;
  pull?: PullContext;
  threads?: ReviewThread[];
  collapsed: boolean;
  /** Undefined when the diff has no viewed state (commits, compare). */
  viewed?: boolean;
  ignoreWs: boolean;
  onToggleCollapsed: (path: string) => void;
  onToggleViewed?: (path: string) => void;
}

export const ROW_H = 20;
const CHUNK_ROWS = 40;
const NO_GAPS: Record<number, GapExpansion> = {};

export const fileDomId = (path: string) => `diff-${path}`;

/** A file in the split diff: sticky header plus lazily rendered body. */
export const FileDiff = memo(function FileDiff(props: FileDiffProps) {
  const { file, collapsed, pull, threads } = props;
  const [fileComment, setFileComment] = useState(false);
  // Once shown, the body stays mounted and is only hidden while collapsed, so toggling is cheap and keeps its state.
  const [opened, setOpened] = useState(!collapsed);
  if (!collapsed && !opened) setOpened(true);
  const closeFileComment = useCallback(() => setFileComment(false), []);
  const comments = threads?.reduce((n, t) => n + t.comments.nodes.length, 0) ?? 0;
  return (
    <section className={`df ${collapsed ? "collapsed" : ""}`} id={fileDomId(file.filename)} data-path={file.filename}>
      <FileHeader {...props} comments={comments} onComment={pull ? () => setFileComment(true) : undefined} />
      {opened && (
        <div className="df-body" style={collapsed ? undefined : { containIntrinsicSize: `auto ${estimateHeight(file)}px` }}>
          <FileBody file={file} source={props.source} pull={pull} threads={threads} ignoreWs={props.ignoreWs} fileComment={fileComment} closeFileComment={closeFileComment} />
        </div>
      )}
    </section>
  );
});

function estimateHeight(f: DiffFile): number {
  if (f.patch === undefined || hiddenReason(f)) return 80;
  return (f.patch.split("\n", 5000).length + 1) * ROW_H;
}

const STATUS_TEXT: Partial<Record<DiffFile["status"], string>> = { added: "Added", removed: "Deleted", renamed: "Renamed", copied: "Copied" };

function DiffStat({ add, del }: { add: number; del: number }) {
  const total = add + del;
  const boxes = Array.from({ length: 5 }, (_, i) => {
    if (!total) return "n";
    const a = Math.round((add / total) * 5);
    return i < a ? "a" : i < Math.min(5, a + Math.max(del ? 1 : 0, Math.round((del / total) * 5))) ? "d" : "n";
  });
  return (
    <span className="diffstat" {...tooltip(`${add} additions, ${del} deletions`)}>
      {add > 0 && <span className="add">+{add.toLocaleString()}</span>}
      {add > 0 && del > 0 && " "}
      {del > 0 && <span className="del">-{del.toLocaleString()}</span>}
      <span className="boxes">
        {boxes.map((b, i) => (
          <i key={i} className={b} />
        ))}
      </span>
    </span>
  );
}

function FileHeader({ file, source, collapsed, viewed, comments, onToggleCollapsed, onToggleViewed, onComment }: FileDiffProps & { comments: number; onComment?: () => void }) {
  const [copied, setCopied] = useState(false);
  const status = STATUS_TEXT[file.status];
  const blob = `https://github.com/${source.owner}/${source.repo}/blob/${source.head}/${file.filename.split("/").map(encodeURIComponent).join("/")}`;
  return (
    <div
      className="df-head"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, label, input") || getSelection()?.toString()) return;
        onToggleCollapsed(file.filename);
      }}
    >
      <button className="btn invisible xs icon" aria-label={collapsed ? "Expand file" : "Collapse file"} aria-expanded={!collapsed} onClick={() => onToggleCollapsed(file.filename)}>
        {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
      </button>
      <span className="df-path truncate" title={file.filename}>
        {file.previous_filename && file.previous_filename !== file.filename && (
          <>
            <span className="muted">{file.previous_filename}</span>
            {" → "}
          </>
        )}
        {file.filename}
      </span>
      <button
        className="btn invisible xs icon"
        {...tooltip("Copy path", "label")}
        onClick={() => {
          copyText(file.filename).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }, () => {});
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      {status && <span className={`label df-status ${file.status}`}>{status}</span>}
      <span className="grow" />
      {comments > 0 && (
        <span className="muted row" style={{ gap: 4, fontSize: 12 }} {...tooltip(`${comments} comments`)}>
          <CommentIcon size={14} />
          {comments}
        </span>
      )}
      <DiffStat add={file.additions} del={file.deletions} />
      {onToggleViewed && (
        <label className={`df-viewed ${viewed ? "on" : ""}`} {...tooltip("Mark as viewed (v)")}>
          <input type="checkbox" checked={!!viewed} onChange={() => onToggleViewed(file.filename)} />
          Viewed
        </label>
      )}
      {onComment && (
        <button className="btn invisible xs icon" {...tooltip("Comment on this file", "label")} onClick={onComment}>
          <CommentIcon />
        </button>
      )}
      {file.status !== "removed" && (
        <a className="btn invisible xs icon" href={blob} target="_blank" rel="noopener noreferrer" {...tooltip("View file on GitHub", "label")}>
          <KebabHorizontalIcon />
        </a>
      )}
    </div>
  );
}

interface Selection {
  side: "L" | "R";
  a: number;
  b: number;
  open: boolean;
}

interface Loaded {
  hunks: Hunk[];
  head?: string[];
  binary: boolean;
}

/** Token lookup for one side of a file. */
interface SideTok {
  tokens: Tokens;
  idx: (n: number) => number;
}

function patchIndex(nums: Int32Array) {
  return (n: number) => {
    let lo = 0;
    let hi = nums.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nums[mid] === n) return mid;
      if (nums[mid] < n) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  };
}

type FileBodyProps = Pick<FileDiffProps, "file" | "source" | "pull" | "threads" | "ignoreWs"> & { fileComment: boolean; closeFileComment: () => void };

// Memoized so collapsing or marking the file viewed doesn't re-render its body.
const FileBody = memo(function FileBody(props: FileBodyProps) {
  const { file, source, pull, threads, ignoreWs, fileComment, closeFileComment } = props;
  const hidden = hiddenReason(file);
  const needsFetch = file.patch === undefined && file.changes > 0;
  const [load, setLoad] = useState(!hidden && !needsFetch);
  // Expanded gaps and fetched head lines, tagged with the diff version they belong to.
  const gapsId = ignoreWs ? `${source.id}:w` : source.id;
  const [expansionState, setExpansion] = useState<{ id: string; gaps: Record<number, GapExpansion> }>({ id: gapsId, gaps: NO_GAPS });
  const [headState, setHead] = useState<{ id: string; lines: string[] }>();
  const expansion = expansionState.id === gapsId ? expansionState.gaps : NO_GAPS;
  const head = headState?.id === source.id ? headState.lines : undefined;
  const [expandError, setExpandError] = useState<unknown>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  // Pointer position while dragging a selection, else null.
  const dragging = useRef<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);

  const loaded = useQuery({
    queryKey: ["loaded-diff", source.id, file.filename],
    enabled: load && needsFetch,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 5,
    persister: undefined,
    queryFn: async (): Promise<Loaded> => {
      const oldPath = file.previous_filename ?? file.filename;
      const [oldText, newText] = await Promise.all([
        file.status === "added" ? "" : source.base().then((b) => fetchContent(source.owner, source.repo, oldPath, b)),
        file.status === "removed" ? "" : fetchContent(source.owner, source.repo, file.filename, source.head),
      ]);
      if (isBinaryText(oldText) || isBinaryText(newText)) return { hunks: [], binary: true };
      return { hunks: diffContents(oldText, newText), head: file.status === "removed" ? undefined : splitLines(newText), binary: false };
    },
  });

  const patchHunks = useMemo(() => (file.patch !== undefined ? parsePatch(file.patch) : (loaded.data?.hunks ?? [])), [file.patch, loaded.data]);
  const hunks = useMemo(() => (ignoreWs ? ignoreWhitespace(patchHunks) : patchHunks), [ignoreWs, patchHunks]);
  const headLines = head ?? loaded.data?.head;
  const canExpand = file.status !== "added" && file.status !== "removed" && hunks.length > 0;
  const rows = useMemo(() => (load ? buildRows(hunks, expansion, headLines, canExpand) : []), [load, hunks, expansion, headLines, canExpand]);

  const lang = useMemo(() => languageFor(file.filename), [file.filename]);
  const rendering = load && rows.length > 0;
  const pri = near ? PRI_VISIBLE : PRI_IDLE;
  // Far files queue their highlight jobs one at a time while the page is idle.
  const highlight = useScheduled(ref, rendering, rows.length) && rendering;
  const leftSide = useMemo(() => (highlight ? sideLines(patchHunks, "L") : null), [highlight, patchHunks]);
  const rightSide = useMemo(() => (highlight ? sideLines(patchHunks, "R") : null), [highlight, patchHunks]);
  const lt = useTokens(leftSide?.nums.length ? `${source.id}:${file.filename}:L` : null, lang, () => leftSide!.text, pri);
  const rt = useTokens(rightSide?.nums.length ? `${source.id}:${file.filename}:R` : null, lang, () => rightSide!.text, pri);
  const ft = useTokens(highlight && headLines ? `${source.id}:${file.filename}:full` : null, lang, () => headLines!.join("\n"), pri);
  const ltok = useMemo<SideTok | null>(() => (lt && leftSide ? { tokens: lt, idx: patchIndex(leftSide.nums) } : null), [lt, leftSide]);
  const rtok = useMemo<SideTok | null>(() => {
    if (ft) return { tokens: ft, idx: (n) => n - 1 };
    return rt && rightSide ? { tokens: rt, idx: patchIndex(rightSide.nums) } : null;
  }, [ft, rt, rightSide]);

  const { lmap, rmap, unplaced, fileThreads } = useMemo(() => placeThreads(threads, rows), [threads, rows]);
  // Added and deleted files have lines on one side only and show it as one full-width column.
  const one = useMemo(() => {
    let l = false;
    let r = false;
    for (const row of rows) {
      if (row.r !== "l") continue;
      l ||= !!row.L;
      r ||= !!row.R;
    }
    return l === r ? undefined : l ? "L" : "R";
  }, [rows]);

  // Chunks take onExpand; keeping it stable lets them skip re-rendering when, e.g., hiding whitespace leaves this file as it was.
  const latest = useRef({ headLines, hunks, source, gapsId });
  latest.current = { headLines, hunks, source, gapsId };
  const onExpand = useCallback(
    async (gap: number, dir: "up" | "down" | "all") => {
      const { headLines, hunks, source, gapsId } = latest.current;
      setExpandError(null);
      const id = source.id;
      let lines = headLines;
      if (!lines) {
        try {
          lines = splitLines(await fetchContent(source.owner, source.repo, file.filename, source.head));
        } catch (e) {
          setExpandError(e);
          return;
        }
        setHead({ id, lines });
      }
      const len = lines.length;
      setExpansion((prev) => {
        const gaps = prev.id === gapsId ? prev.gaps : {};
        return { id: gapsId, gaps: { ...gaps, [gap]: expandGap(hunks, gap, len, gaps[gap], dir) } };
      });
    },
    [file.filename],
  );

  // Hunk of each commentable line per side; GitHub rejects comment ranges that span hunks.
  const hunkOf = useMemo(() => {
    const L = new Map<number, number>();
    const R = new Map<number, number>();
    let h = 0;
    for (const r of rows) {
      if (r.r === "h" || !r.c) {
        h++;
        continue;
      }
      if (r.L) L.set(r.L.n, h);
      if (r.R) R.set(r.R.n, h);
    }
    return { L, R };
  }, [rows]);
  /** `b` moved toward `a` until both are in the same hunk. */
  const clampEnd = (side: "L" | "R", a: number, b: number) => {
    const m = hunkOf[side];
    const h = m.get(a);
    if (h === undefined || m.get(b) === h) return b;
    const step = b > a ? 1 : -1;
    let n = a;
    while (n !== b && m.get(n + step) === h) n += step;
    return n;
  };

  // Line selection for new comments: mousedown on a line number, drag or shift-click to extend.
  const commentable = !!pull;
  const onMouseDown = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".dn[data-c]");
    if (!el || e.button !== 0 || !commentable) return;
    e.preventDefault();
    const side = el.dataset.s as "L" | "R";
    const n = Number(el.dataset.n);
    dragging.current = `${e.clientX},${e.clientY}`;
    setSel((prev) => (e.shiftKey && prev && prev.side === side ? { side, a: prev.a, b: clampEnd(side, prev.a, n), open: false } : { side, a: n, b: n, open: false }));
  };
  const onMouseOver = (e: MouseEvent) => {
    // Layout shifts under a still pointer (e.g. the open form closing) also fire mouseover; only real moves extend the range.
    const at = `${e.clientX},${e.clientY}`;
    if (dragging.current === null || dragging.current === at) return;
    dragging.current = at;
    const el = (e.target as HTMLElement).closest<HTMLElement>(".dn[data-c]");
    if (!el) return;
    const side = el.dataset.s;
    const n = Number(el.dataset.n);
    setSel((prev) => {
      if (!prev || prev.side !== side) return prev;
      const b = clampEnd(prev.side, prev.a, n);
      return prev.b !== b ? { ...prev, b } : prev;
    });
  };
  useEffect(() => {
    const up = () => {
      if (dragging.current === null) return;
      dragging.current = null;
      setSel((prev) => prev && { ...prev, open: true });
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  const closeForm = useCallback(() => setSel(null), []);

  const chunks = useMemo(() => {
    const out: Row[][] = [];
    for (let i = 0; i < rows.length; i += CHUNK_ROWS) out.push(rows.slice(i, i + CHUNK_ROWS));
    return out;
  }, [rows]);
  // Row indices in each chunk that start a run of changed lines, for j/k.
  const chunkBlocks = useMemo(() => {
    const out: string[][] = chunks.map(() => []);
    let prev = false;
    rows.forEach((r, i) => {
      const changed = r.r === "l" && ((!!r.L && r.L.k !== CTX) || (!!r.R && r.R.k !== CTX));
      if (changed && !prev) out[Math.floor(i / CHUNK_ROWS)].push(String(i % CHUNK_ROWS));
      prev = changed;
    });
    return out.map((b) => b.join(","));
  }, [chunks, rows]);

  const range = sel && { side: sel.side, start: Math.min(sel.a, sel.b), end: Math.max(sel.a, sel.b) };
  const suggestion = useMemo(() => {
    if (!range || !sel?.open || range.side !== "R") return undefined;
    return rows
      .filter((r): r is Extract<Row, { r: "l" }> => r.r === "l" && !!r.R && r.R.n >= range.start && r.R.n <= range.end && r.R.k !== DEL)
      .map((r) => r.R!.t)
      .join("\n");
  }, [rows, range?.side, range?.start, range?.end, sel?.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const form =
    pull && sel?.open && range ? (
      <NewThreadForm
        owner={pull.owner}
        repo={pull.repo}
        number={pull.number}
        pullId={pull.pullId}
        commitId={pull.head}
        path={file.filename}
        subjectType="LINE"
        side={range.side === "L" ? "LEFT" : "RIGHT"}
        line={range.end}
        startLine={range.start !== range.end ? range.start : undefined}
        startSide={range.start !== range.end ? (range.side === "L" ? "LEFT" : "RIGHT") : undefined}
        suggestionSource={suggestion}
        onClose={closeForm}
      />
    ) : null;

  const maxNum = useMemo(() => {
    let m = 0;
    for (const h of patchHunks) m = Math.max(m, h.oldStart + h.oldLines, h.newStart + h.newLines);
    return Math.max(m, headLines?.length ?? 0);
  }, [patchHunks, headLines]);
  const nw = `${Math.max(3, String(maxNum).length) + 3}ch`;

  const top = (
    <>
      {pull && fileComment && (
        <div className="df-filecomment">
          <NewThreadForm owner={pull.owner} repo={pull.repo} number={pull.number} pullId={pull.pullId} commitId={pull.head} path={file.filename} subjectType="FILE" onClose={closeFileComment} />
        </div>
      )}
      {pull && (fileThreads.length > 0 || unplaced.length > 0) && (
        <div className="df-threads">
          {fileThreads.map((t) => (
            <ReviewThreadView key={t.id} thread={t} owner={pull.owner} repo={pull.repo} number={pull.number} pullId={pull.pullId} />
          ))}
          {unplaced.length > 0 && (
            <details>
              <summary className="muted">
                {unplaced.length} {load && unplaced.every((t) => t.isOutdated) ? "outdated " : ""}
                {unplaced.length === 1 ? "conversation" : "conversations"} {load ? "not shown in this diff" : "on this file"}
              </summary>
              {unplaced.map((t) => (
                <ReviewThreadView key={t.id} thread={t} owner={pull.owner} repo={pull.repo} number={pull.number} pullId={pull.pullId} showHunk />
              ))}
            </details>
          )}
        </div>
      )}
    </>
  );

  let notice: ReactNode = null;
  if (!load) {
    notice = (
      <>
        <span>{hidden ?? "Large diffs are not rendered by default."}</span>
        <button className="btn sm" onClick={() => setLoad(true)}>
          Load diff
        </button>
      </>
    );
  } else if (loaded.isLoading) notice = <Spinner label={`Loading diff for ${file.filename}`} />;
  else if (loaded.error) notice = <ErrorBanner error={loaded.error} action={<button className="btn sm" onClick={() => loaded.refetch()}>Retry</button>} />;
  else if (loaded.data?.binary || (file.patch === undefined && file.changes === 0 && file.status !== "renamed")) notice = <span>Binary file not shown.</span>;
  else if (!rows.length && patchHunks.length) notice = <span>Whitespace-only changes.</span>;
  else if (!rows.length) notice = <span>{file.status === "renamed" ? "File renamed without changes." : file.status === "added" ? "Empty file added." : file.status === "removed" ? "Empty file deleted." : "File mode changed."}</span>;

  return (
    <div ref={ref} onMouseDown={onMouseDown} onMouseOver={onMouseOver} style={{ ["--nw" as string]: nw }}>
      {top}
      {expandError != null && <ErrorBanner error={expandError} />}
      {notice ? (
        <div className="df-notice">{notice}</div>
      ) : (
        chunks.map((c, i) => {
          const chunkRange = range && overlaps(c, range) ? range : undefined;
          return (
            <Chunk
              key={i}
              rows={c}
              blocks={chunkBlocks[i]}
              ltok={ltok}
              rtok={rtok}
              lmap={lmap}
              rmap={rmap}
              one={one}
              pull={pull}
              sel={chunkRange}
              form={chunkRange && sel?.open ? form : null}
              onExpand={onExpand}
            />
          );
        })
      )}
    </div>
  );
});

function overlaps(rows: Row[], range: { side: "L" | "R"; start: number; end: number }) {
  for (const r of rows) {
    if (r.r !== "l") continue;
    const c = range.side === "L" ? r.L : r.R;
    if (c && c.n >= range.start && c.n <= range.end) return true;
  }
  return false;
}

function placeThreads(threads: ReviewThread[] | undefined, rows: Row[]) {
  const lmap = new Map<number, ReviewThread[]>();
  const rmap = new Map<number, ReviewThread[]>();
  const unplaced: ReviewThread[] = [];
  const fileThreads: ReviewThread[] = [];
  if (!threads?.length) return { lmap, rmap, unplaced, fileThreads };
  const lnums = new Set<number>();
  const rnums = new Set<number>();
  for (const r of rows) {
    if (r.r !== "l") continue;
    if (r.L) lnums.add(r.L.n);
    if (r.R) rnums.add(r.R.n);
  }
  for (const t of threads) {
    if (t.subjectType === "FILE") {
      fileThreads.push(t);
      continue;
    }
    const left = t.diffSide === "LEFT";
    if (t.line == null || !(left ? lnums : rnums).has(t.line)) {
      unplaced.push(t);
      continue;
    }
    const map = left ? lmap : rmap;
    const list = map.get(t.line);
    if (list) list.push(t);
    else map.set(t.line, [t]);
  }
  return { lmap, rmap, unplaced, fileThreads };
}

interface ChunkProps {
  rows: Row[];
  /** Comma-separated row indices that start a change block. */
  blocks: string;
  ltok: SideTok | null;
  rtok: SideTok | null;
  lmap: Map<number, ReviewThread[]>;
  rmap: Map<number, ReviewThread[]>;
  /** The only side shown, for files with lines on one side. */
  one?: "L" | "R";
  pull?: PullContext;
  sel?: { side: "L" | "R"; start: number; end: number } | null;
  form: ReactNode;
  onExpand: (gap: number, dir: "up" | "down" | "all") => void;
}

const KIND_CLASS = ["ctx", "del", "add"] as const;

/** Up to CHUNK_ROWS rows in one grid; mounted when near the viewport or when the page is idle. */
const Chunk = memo(function Chunk({ rows, blocks, ltok, rtok, lmap, rmap, one, pull, sel, form, onExpand }: ChunkProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useScheduled(ref, true, rows.length);
  // Scheduled alongside mounting, so a chunk that comes near with its tokens ready renders once, already coloured.
  const colored = useScheduled(ref, !!(ltok || rtok), rows.length);
  if (!mounted) return <div ref={ref} className="dk-ph" data-blocks={blocks || undefined} style={{ height: rows.length * ROW_H }} />;
  const starts = blocks ? blocks.split(",").map(Number) : [];
  const L = colored ? ltok : null;
  const R = colored ? rtok : null;
  const showL = one !== "R";
  const showR = one !== "L";
  const out: ReactNode[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.r === "h") {
      out.push(<HunkRow key={`h${i}`} row={row} onExpand={onExpand} />);
      continue;
    }
    const key = row.R ? `r${row.R.n}` : `l${row.L!.n}`;
    const c = row.c && !!pull;
    const lSel = !!sel && sel.side === "L" && !!row.L && row.L.n >= sel.start && row.L.n <= sel.end;
    const rSel = !!sel && sel.side === "R" && !!row.R && row.R.n >= sel.start && row.R.n <= sel.end;
    // Expanded context shows head text on both sides, so it takes the right side's tokens.
    let lTok = L && row.L && row.c ? lookup(L, row.L.n) : null;
    if (!lTok && row.L?.k === CTX && row.R && R) lTok = lookup(R, row.R.n);
    const rTok = R && row.R ? lookup(R, row.R.n) : null;
    const blk = starts.includes(i);
    if (showL) out.push(<NumCell key={`${key}a`} cell={row.L} side="L" c={c} sel={lSel} blk={blk} />, <CodeCell key={`${key}b`} cell={row.L} tok={lTok} sel={lSel} />);
    if (showR) out.push(<NumCell key={`${key}c`} cell={row.R} side="R" c={c} sel={rSel} blk={blk && !showL} />, <CodeCell key={`${key}d`} cell={row.R} tok={rTok} sel={rSel} />);
    const lt = row.L && lmap.get(row.L.n);
    const rt = row.R && rmap.get(row.R.n);
    const fl = form && sel?.side === "L" && row.L?.n === sel.end && row.c;
    const fr = form && sel?.side === "R" && row.R?.n === sel.end && row.c;
    if (lt || rt || fl || fr) {
      if (showL)
        out.push(
          <div key={`${key}t`} className="dt">
            {lt && pull && lt.map((t) => <ReviewThreadView key={t.id} thread={t} owner={pull.owner} repo={pull.repo} number={pull.number} pullId={pull.pullId} />)}
            {fl && form}
          </div>,
        );
      if (showR)
        out.push(
          <div key={`${key}u`} className="dt">
            {rt && pull && rt.map((t) => <ReviewThreadView key={t.id} thread={t} owner={pull.owner} repo={pull.repo} number={pull.number} pullId={pull.pullId} />)}
            {fr && form}
          </div>,
        );
    }
  }
  return (
    <div ref={ref} className={one ? "dk one" : "dk"} data-blocks={blocks || undefined} style={{ containIntrinsicSize: `auto ${rows.length * ROW_H}px` }}>
      {out}
    </div>
  );
});

function lookup(s: SideTok, n: number): { tokens: Tokens; i: number } | null {
  const i = s.idx(n);
  return i >= 0 && i < s.tokens.starts.length - 1 ? { tokens: s.tokens, i } : null;
}

function NumCell({ cell, side, c, sel, blk }: { cell?: Cell; side: "L" | "R"; c: boolean; sel: boolean; blk?: boolean }) {
  if (!cell) return <div className="dn empty" data-blk={blk ? "" : undefined} />;
  return <div className={`dn ${KIND_CLASS[cell.k]}${sel ? " sel" : ""}`} data-n={cell.n} data-s={side} data-c={c ? "" : undefined} data-blk={blk ? "" : undefined} />;
}

/** Indentation and the first word, which wrap together so indentation never fills a row alone. */
const LEAD = /^[ \t]+[^ \t]+/;

function CodeCell({ cell, tok, sel }: { cell?: Cell; tok: { tokens: Tokens; i: number } | null; sel: boolean }) {
  if (!cell) return <div className="dc empty" />;
  const ranges = cell.k !== CTX ? wordRanges(cell) : null;
  const lead = LEAD.exec(cell.t)?.[0].length ?? 0;
  return <div className={`dc ${KIND_CLASS[cell.k]}${sel ? " sel" : ""}`}>{codeNodes(cell.t, tok, ranges, lead)}</div>;
}

function codeNodes(text: string, tok: { tokens: Tokens; i: number } | null, ranges: [number, number][] | null, lead: number): ReactNode {
  if (!tok && !ranges?.length) {
    return lead ? [<span key="i" className="di">{text.slice(0, lead)}</span>, text.slice(lead)] : text;
  }
  const out: ReactNode[] = [];
  let ri = 0;
  let leadNodes = 0;
  const emit = (s: number, e: number, cls: number) => {
    while (s < e) {
      while (ranges && ri < ranges.length && ranges[ri][1] <= s) ri++;
      const r = ranges?.[ri];
      let end = e;
      let marked = false;
      if (r) {
        if (r[0] <= s) {
          marked = true;
          end = Math.min(e, r[1]);
        } else end = Math.min(e, r[0]);
      }
      if (s < lead) end = Math.min(end, lead);
      const t = text.slice(s, end);
      const c = cls ? (marked ? `hl-${cls} wd` : `hl-${cls}`) : marked ? "wd" : "";
      out.push(c ? <span key={s} className={c}>{t}</span> : t);
      s = end;
      if (s === lead) leadNodes = out.length;
    }
  };
  let pos = 0;
  if (tok) {
    const { starts, data } = tok.tokens;
    for (let j = starts[tok.i]; j < starts[tok.i + 1] && pos < text.length; j += 2) {
      const end = Math.min(text.length, pos + data[j]);
      emit(pos, end, data[j + 1]);
      pos = end;
    }
  }
  if (pos < text.length) emit(pos, text.length, 0);
  return lead ? [<span key="i" className="di">{out.slice(0, leadNodes)}</span>, ...out.slice(leadNodes)] : out;
}

function HunkRow({ row, onExpand }: { row: Extract<Row, { r: "h" }>; onExpand: (gap: number, dir: "up" | "down" | "all") => void }) {
  return (
    <div className="dh">
      <span className="dh-btns">
        {row.down && (
          <button className="dh-btn" {...tooltip("Expand down", "label")} onClick={() => onExpand(row.gap, "down")}>
            <FoldDownIcon size={14} />
          </button>
        )}
        {row.up && (
          <button className="dh-btn" {...tooltip("Expand up", "label")} onClick={() => onExpand(row.gap, "up")}>
            <FoldUpIcon size={14} />
          </button>
        )}
        {row.all && (
          <button className="dh-btn" {...tooltip("Expand all", "label")} onClick={() => onExpand(row.gap, "all")}>
            <UnfoldIcon size={14} />
          </button>
        )}
      </span>
      <span className="dh-text">{row.text}</span>
    </div>
  );
}
