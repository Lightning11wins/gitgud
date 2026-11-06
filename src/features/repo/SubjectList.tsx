import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { SearchIcon } from "@primer/octicons-react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Spinner } from "@/components/Spinner";
import { useHotkey } from "@/lib/hotkeys";
import { usePrinting } from "@/lib/usePrinting";
import { ListRow, ROW_HEIGHT, itemPath } from "./ListRow";
import type { ListChecks, ListData } from "./searchList";
import "./list.css";

const LOAD_AHEAD = 20;
// About a screen of rows on each side, so fast scrolling rarely outruns rendering.
const OVERSCAN = 20;

export interface SubjectListProps {
  data: ListData | undefined;
  /** Check summaries by item id; rows show none until theirs loads. */
  checks?: ListChecks;
  isPending: boolean;
  isFetching: boolean;
  error: unknown;
  moreError: unknown;
  loadingMore: boolean;
  onRetry: () => void;
  loadMore: () => void;
  showRepo?: boolean;
  /** Show each row's last update time. */
  showUpdated?: boolean;
  /** Rendered when a finished search has no results. */
  empty: ReactNode;
  /** Header content (toggles, counts); the list renders under it inside the same box. */
  header?: ReactNode;
  /** Header controls on the right (filters, sort). They get their own row when the header is narrow. */
  actions?: ReactNode;
}

/** Virtualized, auto-paging list of issues and PRs with j/k/Enter keyboard navigation. */
export function SubjectList(props: SubjectListProps) {
  const { data, checks, isPending, isFetching, error, moreError, loadingMore, onRetry, loadMore, showRepo, showUpdated, empty, header, actions } = props;
  const items = data?.items ?? [];
  const navigate = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [active, setActive] = useState(-1);
  const printing = usePrinting();

  useLayoutEffect(() => {
    const top = (bodyRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    if (Math.abs(top - margin) > 0.5) setMargin(top);
  });

  const hasMore = !!data?.hasNextPage;
  const count = items.length + (hasMore ? 1 : 0);
  const virtualizer = useWindowVirtualizer({ count, estimateSize: () => ROW_HEIGHT, overscan: OVERSCAN, scrollMargin: margin });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.length ? virtualItems[virtualItems.length - 1].index : 0;

  useEffect(() => {
    if (hasMore && !moreError && !loadingMore && lastIndex >= items.length - LOAD_AHEAD) loadMore();
  }, [hasMore, moreError, loadingMore, lastIndex, items.length, loadMore]);

  const move = (delta: number) => {
    if (!items.length) return;
    const next = Math.max(0, Math.min(items.length - 1, active + delta));
    setActive(next);
    virtualizer.scrollToIndex(next, { align: "auto" });
  };
  useHotkey("j", () => move(1));
  useHotkey("k", () => move(-1));
  const open = () => {
    const item = items[active];
    if (item) navigate(itemPath(item));
  };
  useHotkey("o", open);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Enter" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (t && (t.closest("a, button, input, textarea, select") || t.isContentEditable)) return;
      openRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  let body: ReactNode;
  if (error && !data) {
    body = (
      <div className="lr-state">
        <ErrorBanner
          error={error}
          action={
            <button className="btn sm" onClick={onRetry}>
              Retry
            </button>
          }
        />
      </div>
    );
  } else if (isPending) {
    body = (
      <div className="blankslate">
        <Spinner size={20} label="Loading results" />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="blankslate lr-empty">
        <SearchIcon size={24} />
        {empty}
      </div>
    );
  } else {
    body = (
      <>
        {printing && (
          <div className="lr-body print-only">
            {items.map((item) => (
              <ListRow key={item.id} item={item} checks={checks?.[item.id]} showRepo={showRepo} showUpdated={showUpdated} />
            ))}
          </div>
        )}
        <div className={printing ? "lr-body screen-only" : "lr-body"} style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((v) => {
            const item = items[v.index];
            const style = { height: v.size, transform: `translateY(${v.start - margin}px)` };
            if (!item) {
              return (
                <div key="more" className="lr-more" style={style}>
                  {moreError ? (
                    <ErrorBanner
                      error={moreError}
                      action={
                        <button className="btn sm" onClick={loadMore}>
                          Retry
                        </button>
                      }
                    />
                  ) : (
                    <Spinner label="Loading more results" />
                  )}
                </div>
              );
            }
            return <ListRow key={item.id} item={item} checks={checks?.[item.id]} showRepo={showRepo} showUpdated={showUpdated} active={v.index === active} style={style} />;
          })}
        </div>
      </>
    );
  }

  return (
    <div className="box lr-box">
      <div className="box-header lr-header">
        <div className="row lr-header-main">
          {header}
          <Spinner label="Checking for updates" show={isFetching && !isPending} />
        </div>
        {actions && <div className="lr-actions">{actions}</div>}
      </div>
      {!!error && !!data && (
        <div className="lr-state">
          <ErrorBanner
            error={error}
            action={
              <button className="btn sm" onClick={onRetry}>
                Retry
              </button>
            }
          />
        </div>
      )}
      <div ref={bodyRef}>{body}</div>
    </div>
  );
}
