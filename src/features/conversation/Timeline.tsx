import { useQuery } from "@tanstack/react-query";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { keys } from "@/api/keys";
import { canWrite, type ReactionContent, type ReviewThread, type SubjectMeta } from "@/api/types";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Spinner } from "@/components/Spinner";
import type { ComposerHandle } from "@/features/composer/Composer";
import { fetchReviewThreads } from "@/features/review/threads";
import { useHotkey } from "@/lib/hotkeys";
import { CommentCard } from "./CommentCard";
import { CommentForm } from "./CommentForm";
import {
  applyReaction,
  deleteComment,
  invalidateSubject,
  patchSubject,
  setMinimized,
  setReaction,
  updateComment,
  updateReviewBody,
  updateSubjectBody,
} from "./mutations";
import { patchTimelineItem, updateTimeline, useTimeline } from "./timeline";
import { buildRows, TimelineRow, type Row, type TimelineActions } from "./TimelineRow";
import type { CommentLike, IssueCommentItem, TimelineItem } from "./types";
import "./conversation.css";

export interface TimelineProps {
  owner: string;
  repo: string;
  number: number;
  kind: "issue" | "pull";
  /** Header data; the body renders as the first comment. */
  subject: SubjectMeta;
  /** Rendered between the timeline and the comment box, e.g. the PR merge box. */
  beforeComposer?: ReactNode;
}

/** Rows rendered in the first frame; the rest stream in over the next frames. */
const FIRST_ROWS = 60;
const ROWS_PER_FRAME = 120;

/** The conversation: body, every timeline item, and the comment box. */
export function Timeline({ owner, repo, number, kind, subject, beforeComposer }: TimelineProps) {
  const timeline = useTimeline(kind, owner, repo, number);
  const threadsQuery = useQuery({
    queryKey: keys.reviewThreads(owner, repo, number),
    queryFn: () => fetchReviewThreads(owner, repo, number),
    enabled: kind === "pull",
  });
  const composer = useRef<ComposerHandle>(null);
  const githubUrl = subject.url;
  const subjectAuthor = subject.author?.login;

  const actions = useMemo<TimelineActions>(() => {
    const patch = <T extends TimelineItem>(id: string, fn: (it: T) => T) => patchTimelineItem<T>(owner, repo, number, id, fn);
    return {
      kind,
      owner,
      repo,
      number,
      subjectAuthor,
      githubUrl,
      quote: (text) => composer.current?.append(text),
      saveComment: async (id, body) => {
        const r = await updateComment(id, body);
        patch<IssueCommentItem>(id, (c) => ({ ...c, ...r }));
      },
      deleteComment: async (id) => {
        await deleteComment(id);
        updateTimeline(owner, repo, number, (items) => items.filter((it) => it.id !== id));
        invalidateSubject(kind, owner, repo, number);
      },
      minimize: async (id, minimize, reason) => {
        await setMinimized(id, minimize, reason);
        patch<IssueCommentItem>(id, (c) => ({ ...c, isMinimized: minimize, minimizedReason: minimize ? (reason ?? "OUTDATED").toLowerCase() : null }));
      },
      react: (id, content, add) => {
        const apply = (a: boolean) => patch<IssueCommentItem>(id, (c) => ({ ...c, reactionGroups: applyReaction(c.reactionGroups, content, a) }));
        apply(add);
        setReaction(id, content, add).catch(() => apply(!add));
      },
      saveReview: async (id, body) => {
        const r = await updateReviewBody(id, body);
        patch<IssueCommentItem>(id, (c) => ({ ...c, ...r }));
      },
    };
  }, [kind, owner, repo, number, subjectAuthor, githubUrl]);

  const items = timeline.data?.items;
  const prevRows = useRef<Row[]>([]);
  const rows = useMemo(() => (prevRows.current = buildRows(items ?? [], prevRows.current)), [items]);
  const threadsByReview = useMemo(() => groupThreads(threadsQuery.data), [threadsQuery.data]);

  const [limit, setLimit] = useState(FIRST_ROWS);
  useEffect(() => {
    if (limit >= rows.length) return;
    const id = requestAnimationFrame(() => startTransition(() => setLimit((l) => l + ROWS_PER_FRAME)));
    return () => cancelAnimationFrame(id);
  }, [limit, rows.length]);

  useScrollToHash(rows, setLimit);
  useHotkey("r", () => composer.current?.focus());
  useHotkey("j", () => moveFocus(1));
  useHotkey("k", () => moveFocus(-1));

  const shown = rows.length > limit ? rows.slice(0, limit) : rows;
  const loadingMore = timeline.isFetching && timeline.data?.stamp === "";

  return (
    <div className="timeline">
      <div className="tl-list">
      <SubjectBody subject={subject} kind={kind} owner={owner} repo={repo} number={number} />
      {shown.map((row) => (
        <TimelineRow key={row.key} row={row} actions={actions} threads={row.type === "item" ? threadsByReview.get(row.item.id) : undefined} />
      ))}
      {(timeline.isPending || loadingMore || rows.length > limit) && (
        <div className="tl-loading muted row">
          <Spinner size={14} /> Loading {items ? `(${items.length} items so far)` : "timeline"}
        </div>
      )}
      {timeline.error && <ErrorBanner error={timeline.error} action={<button className="btn sm" onClick={() => timeline.refetch()}>Retry</button>} />}
      </div>
      {beforeComposer}
      <CommentForm kind={kind} owner={owner} repo={repo} number={number} subject={subject} handle={composer} locked={subject.locked && !canWrite(subject.repository.viewerPermission)} />
    </div>
  );
}

function groupThreads(threads: ReviewThread[] | undefined): Map<string, ReviewThread[]> {
  const map = new Map<string, ReviewThread[]>();
  for (const t of threads ?? []) {
    const reviewId = t.comments.nodes[0]?.pullRequestReview?.id;
    if (!reviewId) continue;
    const list = map.get(reviewId);
    if (list) list.push(t);
    else map.set(reviewId, [t]);
  }
  return map;
}

/** The issue/PR description as the first comment. */
function SubjectBody({ subject, kind, owner, repo, number }: { subject: SubjectMeta; kind: "issue" | "pull"; owner: string; repo: string; number: number }) {
  const comment = useMemo<CommentLike>(
    () => ({
      id: subject.id,
      author: subject.author,
      body: subject.body,
      bodyHTML: subject.bodyHTML,
      createdAt: subject.createdAt,
      url: subject.url,
      viewerCanUpdate: subject.viewerCanUpdate,
      viewerCanReact: true,
      reactionGroups: subject.reactionGroups,
    }),
    [subject.id, subject.author, subject.body, subject.bodyHTML, subject.createdAt, subject.url, subject.viewerCanUpdate, subject.reactionGroups],
  );
  const onSave = useCallback(
    async (body: string) => {
      const r = await updateSubjectBody(kind, subject.id, body);
      patchSubject(kind, owner, repo, number, () => ({ body: r.body, bodyHTML: r.bodyHTML }));
    },
    [kind, subject.id, owner, repo, number],
  );
  const onReact = useCallback(
    (content: ReactionContent, add: boolean) => {
      const apply = (a: boolean) => patchSubject(kind, owner, repo, number, (s) => ({ reactionGroups: applyReaction(s.reactionGroups, content, a) }));
      apply(add);
      setReaction(subject.id, content, add).catch(() => apply(!add));
    },
    [kind, subject.id, owner, repo, number],
  );
  return (
    <div className="tl-item comment body">
      <CommentCard
        comment={comment}
        owner={owner}
        repo={repo}
        draftKey={`${owner}/${repo}#${number}:edit-body`}
        githubUrl={subject.url}
        verb="opened this"
        isSubjectAuthor
        onSave={onSave}
        onReact={onReact}
      />
    </div>
  );
}

/** Scrolls to `#issuecomment-123` style anchors once the target row has rendered. */
function useScrollToHash(rows: Row[], setLimit: (fn: (l: number) => number) => void) {
  const { hash } = useLocation();
  const done = useRef("");
  useEffect(() => {
    if (!hash || done.current === hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const m = /^issuecomment-(\d+)$/.exec(id);
    if (m) {
      const index = rows.findIndex((r) => r.type === "item" && (r.item as IssueCommentItem).databaseId === Number(m[1]));
      if (index >= 0) setLimit((l) => Math.max(l, index + 1));
    }
    const el = document.getElementById(id);
    if (!el) return;
    done.current = hash;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "start" });
      el.classList.add("targeted");
    });
  }, [hash, rows, setLimit]);
}

/** j/k: moves a highlight between comments and scrolls to it. */
function moveFocus(dir: 1 | -1) {
  const list = [...document.querySelectorAll<HTMLElement>(".timeline [data-comment]")];
  if (!list.length) return;
  const current = list.findIndex((el) => el.classList.contains("focused"));
  let next: number;
  if (current >= 0) next = Math.max(0, Math.min(list.length - 1, current + dir));
  else {
    const top = 60;
    const firstBelow = list.findIndex((el) => el.getBoundingClientRect().top >= top);
    next = dir === 1 ? (firstBelow < 0 ? list.length - 1 : firstBelow) : Math.max(0, (firstBelow < 0 ? list.length : firstBelow) - 1);
  }
  list[current]?.classList.remove("focused");
  list[next].classList.add("focused");
  list[next].scrollIntoView({ block: "start" });
}
