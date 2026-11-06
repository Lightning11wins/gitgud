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
const CHUNK_ROWS = 80;
const NO_GAPS: Record<number, GapExpansion> = {};

export const fileDomId = (path: string) => `diff-${path}`;

/** A file in the split diff: sticky header plus lazily rendered body. */
export const FileDiff = memo(function FileDiff(props: FileDiffProps) {
  const { file, collapsed, pull, threads } = props;
  const [fileComment, setFileComment] = useState(false);
  const comments = threads?.reduce((n, t) => n + t.comments.nodes.length, 0) ?? 0;
  const estimate = collapsed ? 0 : estimateHeight(file);
  return (
    <section className={`df ${collapsed ? "collapsed" : ""}`} id={fileDomId(file.filename)} data-path={file.filename}>
      <FileHeader {...props} comments={comments} onComment={pull ? () => setFileComment(true) : undefined} />
      {!collapsed && (
        <div className="df-body" style={{ containIntrinsicSize: `auto ${estimate}px` }}>
          <FileBody {...props} fileComment={fileComment} closeFileComment={() => setFileComment(false)} />
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
    <span className="diffstat" title={`${add} additions, ${del} deletions`}>
      <span className="add">+{add.toLocaleString()}</span> <span className="del">-{del.toLocaleString()}</span>
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
    <div className="df-head" onClick={(e) => e.target === e.currentTarget && onToggleCollapsed(file.filename)}>
      <button className="btn invisible xs icon" aria-label={collapsed ? "Expand file" : "Collapse file"} aria-expanded={!collapsed} onClick={() => onToggleCollapsed(file.filename)}>
        {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
      </button>
      <DiffStat add={file.additions} del={file.deletions} />
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
        title="Copy path"
        aria-label="Copy path"
        onClick={() => {
          navigator.clipboard?.writeText(file.filename).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      {status && <span className={`label df-status ${file.status}`}>{status}</span>}
      <span className="grow" onClick={() => onToggleCollapsed(file.filename)} />
      {comments > 0 && (
        <span className="muted row" style={{ gap: 4, fontSize: 12 }} title={`${comments} comments`}>
          <CommentIcon size={14} />
          {comments}
        </span>
      )}
      {onToggleViewed && (
        <label className={`df-viewed ${viewed ? "on" : ""}`} title="Mark as viewed (v)">
          <input type="checkbox" checked={!!viewed} onChange={() => onToggleViewed(file.filename)} />
          Viewed
        </label>
      )}
      {onComment && (
        <button className="btn invisible xs icon" title="Comment on this file" aria-label="Comment on this file" onClick={onComment}>
          <CommentIcon />
        </button>
      )}
      {file.status !== "removed" && (
        <a className="btn invisible xs icon" href={blob} target="_blank" rel="noopener noreferrer" title="View file on GitHub" aria-label="View file on GitHub">
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

function FileBody(props: FileDiffProps & { fileComment: boolean; closeFileComment: () => void }) {
  const { file, source, pull, threads, ignoreWs, fileComment, closeFileComment } = props;
  const hidden = hiddenReason(file);
  const needsFetch = file.patch === undefined && file.changes > 0;
  const [load, setLoad] = useState(!hidden && !needsFetch);
  // Expanded gaps and fetched head lines, tagged with the diff version they belong to.
  const [expansionState, setExpansion] = useState<{ id: string; gaps: Record<number, GapExpansion> }>({ id: source.id, gaps: {} });
  const [headState, setHead] = useState<{ id: string; lines: string[] }>();
  const expansion = expansionState.id === source.id ? expansionState.gaps : NO_GAPS;
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

  const hunks = useMemo(() => (file.patch !== undefined ? parsePatch(file.patch) : (loaded.data?.hunks ?? [])), [file.patch, loaded.data]);
  const headLines = head ?? loaded.data?.head;
  const canExpand = file.status !== "added" && file.status !== "removed" && hunks.length > 0;
  const rows = useMemo(() => (load ? buildRows(hunks, expansion, headLines, ignoreWs, canExpand) : []), [load, hunks, expansion, headLines, ignoreWs, canExpand]);

  const lang = useMemo(() => languageFor(file.filename), [file.filename]);
  const rendering = load && rows.length > 0;
  const pri = near ? PRI_VISIBLE : PRI_IDLE;
  const leftSide = useMemo(() => (rendering ? sideLines(hunks, "L") : null), [rendering, hunks]);
  const rightSide = useMemo(() => (rendering ? sideLines(hunks, "R") : null), [rendering, hunks]);
  const lt = useTokens(leftSide?.nums.length ? `${source.id}:${file.filename}:L` : null, lang, () => leftSide!.text, pri);
  const rt = useTokens(rightSide?.nums.length ? `${source.id}:${file.filename}:R` : null, lang, () => rightSide!.text, pri);
  const ft = useTokens(rendering && headLines ? `${source.id}:${file.filename}:full` : null, lang, () => headLines!.join("\n"), pri);
  const ltok = useMemo<SideTok | null>(() => (lt && leftSide ? { tokens: lt, idx: patchIndex(leftSide.nums) } : null), [lt, leftSide]);
  const rtok = useMemo<SideTok | null>(() => {
    if (ft) return { tokens: ft, idx: (n) => n - 1 };
    return rt && rightSide ? { tokens: rt, idx: patchIndex(rightSide.nums) } : null;
  }, [ft, rt, rightSide]);

  const { lmap, rmap, unplaced, fileThreads } = useMemo(() => placeThreads(threads, rows), [threads, rows]);

  const onExpand = useCallback(
    async (gap: number, dir: "up" | "down" | "all") => {
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
        const gaps = prev.id === id ? prev.gaps : {};
        return { id, gaps: { ...gaps, [gap]: expandGap(hunks, gap, len, gaps[gap], dir) } };
      });
    },
    [headLines, hunks, source, file.filename],
  );

  // Line selection for new comments: mousedown on a line number, drag or shift-click to extend.
  const commentable = !!pull;
  const onMouseDown = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".dn[data-c]");
    if (!el || e.button !== 0 || !commentable) return;
    e.preventDefault();
    const side = el.dataset.s as "L" | "R";
    const n = Number(el.dataset.n);
    dragging.current = `${e.clientX},${e.clientY}`;
    setSel((prev) => (e.shiftKey && prev && prev.side === side ? { side, a: prev.a, b: n, open: false } : { side, a: n, b: n, open: false }));
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
    setSel((prev) => (prev && prev.side === side && prev.b !== n ? { ...prev, b: n } : prev));
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
    for (const h of hunks) m = Math.max(m, h.oldStart + h.oldLines, h.newStart + h.newLines);
    return Math.max(m, headLines?.length ?? 0);
  }, [hunks, headLines]);
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
                {unplaced.length} outdated {unplaced.length === 1 ? "conversation" : "conversations"} not shown in this diff
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
  } else if (loaded.isLoading) notice = <Spinner />;
  else if (loaded.error) notice = <ErrorBanner error={loaded.error} action={<button className="btn sm" onClick={() => loaded.refetch()}>Retry</button>} />;
  else if (loaded.data?.binary || (file.patch === undefined && file.changes === 0 && file.status !== "renamed")) notice = <span>Binary file not shown.</span>;
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
              ltok={ltok}
              rtok={rtok}
              lmap={lmap}
              rmap={rmap}
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
}

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
  ltok: SideTok | null;
  rtok: SideTok | null;
  lmap: Map<number, ReviewThread[]>;
  rmap: Map<number, ReviewThread[]>;
  pull?: PullContext;
  sel?: { side: "L" | "R"; start: number; end: number } | null;
  form: ReactNode;
  onExpand: (gap: number, dir: "up" | "down" | "all") => void;
}

const KIND_CLASS = ["ctx", "del", "add"] as const;

/** Up to CHUNK_ROWS rows in one grid; mounted when near the viewport or when the page is idle. */
const Chunk = memo(function Chunk({ rows, ltok, rtok, lmap, rmap, pull, sel, form, onExpand }: ChunkProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useScheduled(ref, true, rows.length);
  const colored = useScheduled(ref, mounted && !!(ltok || rtok), rows.length);
  if (!mounted) return <div ref={ref} className="dk-ph" style={{ height: rows.length * ROW_H }} />;
  const L = colored ? ltok : null;
  const R = colored ? rtok : null;
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
    let lTok = L && row.L ? lookup(L, row.L.n) : null;
    if (!lTok && row.L?.k === CTX && row.R && R) lTok = lookup(R, row.R.n);
    const rTok = R && row.R ? lookup(R, row.R.n) : null;
    out.push(
      <NumCell key={`${key}a`} cell={row.L} side="L" c={c} sel={lSel} />,
      <CodeCell key={`${key}b`} cell={row.L} tok={lTok} sel={lSel} />,
      <NumCell key={`${key}c`} cell={row.R} side="R" c={c} sel={rSel} />,
      <CodeCell key={`${key}d`} cell={row.R} tok={rTok} sel={rSel} />,
    );
    const lt = row.L && lmap.get(row.L.n);
    const rt = row.R && rmap.get(row.R.n);
    const fl = form && sel?.side === "L" && row.L?.n === sel.end && row.c;
    const fr = form && sel?.side === "R" && row.R?.n === sel.end && row.c;
    if (lt || rt || fl || fr) {
      out.push(
        <div key={`${key}t`} className="dt">
          {lt && pull && lt.map((t) => <ReviewThreadView key={t.id} thread={t} owner={pull.owner} repo={pull.repo} number={pull.number} pullId={pull.pullId} />)}
          {fl && form}
        </div>,
        <div key={`${key}u`} className="dt">
          {rt && pull && rt.map((t) => <ReviewThreadView key={t.id} thread={t} owner={pull.owner} repo={pull.repo} number={pull.number} pullId={pull.pullId} />)}
          {fr && form}
        </div>,
      );
    }
  }
  return (
    <div ref={ref} className="dk" style={{ containIntrinsicSize: `auto ${rows.length * ROW_H}px` }}>
      {out}
    </div>
  );
});

function lookup(s: SideTok, n: number): { tokens: Tokens; i: number } | null {
  const i = s.idx(n);
  return i >= 0 && i < s.tokens.starts.length - 1 ? { tokens: s.tokens, i } : null;
}

function NumCell({ cell, side, c, sel }: { cell?: Cell; side: "L" | "R"; c: boolean; sel: boolean }) {
  if (!cell) return <div className="dn empty" />;
  return <div className={`dn ${KIND_CLASS[cell.k]}${sel ? " sel" : ""}`} data-n={cell.n} data-s={side} data-c={c ? "" : undefined} />;
}

function CodeCell({ cell, tok, sel }: { cell?: Cell; tok: { tokens: Tokens; i: number } | null; sel: boolean }) {
  if (!cell) return <div className="dc empty" />;
  const ranges = cell.k !== CTX ? wordRanges(cell) : null;
  return <div className={`dc ${KIND_CLASS[cell.k]}${sel ? " sel" : ""}`}>{codeNodes(cell.t, tok, ranges)}</div>;
}

function codeNodes(text: string, tok: { tokens: Tokens; i: number } | null, ranges: [number, number][] | null): ReactNode {
  if (!tok && !ranges?.length) return text;
  const out: ReactNode[] = [];
  let ri = 0;
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
      const t = text.slice(s, end);
      const c = cls ? (marked ? `hl-${cls} wd` : `hl-${cls}`) : marked ? "wd" : "";
      out.push(c ? <span key={s} className={c}>{t}</span> : t);
      s = end;
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
  return out;
}

function HunkRow({ row, onExpand }: { row: Extract<Row, { r: "h" }>; onExpand: (gap: number, dir: "up" | "down" | "all") => void }) {
  return (
    <div className="dh">
      <span className="dh-btns">
        {row.down && (
          <button className="dh-btn" title="Expand down" aria-label="Expand down" onClick={() => onExpand(row.gap, "down")}>
            <FoldDownIcon size={14} />
          </button>
        )}
        {row.up && (
          <button className="dh-btn" title="Expand up" aria-label="Expand up" onClick={() => onExpand(row.gap, "up")}>
            <FoldUpIcon size={14} />
          </button>
        )}
        {row.all && (
          <button className="dh-btn" title="Expand all" aria-label="Expand all" onClick={() => onExpand(row.gap, "all")}>
            <UnfoldIcon size={14} />
          </button>
        )}
      </span>
      <span className="dh-text">{row.text}</span>
    </div>
  );
}
