import { KebabHorizontalIcon } from "@primer/octicons-react";
import { useRef, useState, type ReactNode } from "react";
import type { ReactionContent } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Markdown } from "@/components/Markdown";
import { Popover } from "@/components/Popover";
import { RelativeTime } from "@/components/RelativeTime";
import { Composer } from "@/features/composer/Composer";
import { quote } from "@/features/composer/format";
import type { MinimizeReason } from "./mutations";
import { ReactionBar } from "@/components/Reactions";
import type { CommentLike } from "./types";

const ASSOCIATION: Record<string, string> = {
  OWNER: "Owner",
  MEMBER: "Member",
  COLLABORATOR: "Collaborator",
  CONTRIBUTOR: "Contributor",
  FIRST_TIME_CONTRIBUTOR: "First-time contributor",
  FIRST_TIMER: "First-time contributor",
};

export interface CommentCardProps {
  comment: CommentLike;
  owner: string;
  repo: string;
  /** Drafts key for the inline editor. */
  draftKey: string;
  githubUrl?: string;
  /** DOM id, e.g. `issuecomment-123`, so github.com anchors work. */
  anchor?: string;
  verb?: string;
  isSubjectAuthor?: boolean;
  /** Extra header content, e.g. a review state. */
  headerExtra?: ReactNode;
  className?: string;
  onSave?: (body: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onReact: (content: ReactionContent, add: boolean) => void;
  onQuote?: (text: string) => void;
  onMinimize?: (minimize: boolean, reason?: MinimizeReason) => Promise<void>;
  canMinimize?: boolean;
}

/** A comment box with header, menu, inline editing, and reactions. */
export function CommentCard(props: CommentCardProps) {
  const { comment: c, owner, repo, draftKey, githubUrl, anchor, verb = "commented", isSubjectAuthor, headerExtra, className } = props;
  const { onSave, onDelete, onReact, onQuote, onMinimize, canMinimize } = props;
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const login = c.author?.login ?? "ghost";
  const assoc = c.authorAssociation && ASSOCIATION[c.authorAssociation];

  const doQuote = () => {
    const sel = window.getSelection();
    const selected = sel && !sel.isCollapsed && bodyRef.current?.contains(sel.anchorNode) ? sel.toString() : "";
    onQuote?.(quote(selected || c.body));
  };

  const act = (fn: () => Promise<void>) => {
    setMenu(null);
    setError(null);
    fn().catch(setError);
  };

  if (c.isMinimized && !showHidden) {
    return (
      <div className={`comment-box minimized ${className ?? ""}`} id={anchor}>
        <div className="comment-header row">
          <span className="grow muted">
            This comment from <strong>{login}</strong> was marked as {(c.minimizedReason ?? "hidden").toLowerCase().replace("_", " ")}.
          </span>
          <button className="btn xs" onClick={() => setShowHidden(true)}>
            Show comment
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`comment-box ${className ?? ""}`} id={anchor} data-comment>
      <div className="comment-header row">
        <a href={c.author?.url} target="_blank" rel="noopener noreferrer" className="comment-avatar" tabIndex={-1}>
          <Avatar src={c.author?.avatarUrl} size={20} login={login} />
        </a>
        <span className="grow truncate">
          <a className="comment-author" href={c.author?.url} target="_blank" rel="noopener noreferrer">
            {login}
          </a>{" "}
          <span className="muted">
            {verb}{" "}
            <a className="muted" href={c.url} target="_blank" rel="noopener noreferrer">
              <RelativeTime date={c.createdAt} />
            </a>
            {c.lastEditedAt && <span title={`Edited ${new Date(c.lastEditedAt).toLocaleString()}`}> · edited</span>}
          </span>
          {headerExtra}
        </span>
        {isSubjectAuthor && <span className="label comment-badge">Author</span>}
        {assoc && <span className="label comment-badge">{assoc}</span>}
        {c.isMinimized && (
          <button className="btn xs" onClick={() => setShowHidden(false)}>
            Hide
          </button>
        )}
        <button className="btn invisible xs icon" aria-label="Comment actions" onClick={(e) => setMenu(menu ? null : e.currentTarget)}>
          <KebabHorizontalIcon />
        </button>
        {menu && (
          <Popover anchor={menu} onClose={() => setMenu(null)} align="end" width={200}>
            <div className="select-menu-list">
              <button
                className="select-menu-item"
                onClick={() => {
                  navigator.clipboard?.writeText(c.url).then(() => setCopied(true));
                  setTimeout(() => setCopied(false), 1500);
                  setMenu(null);
                }}
              >
                Copy link
              </button>
              {onQuote && (
                <button className="select-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => (setMenu(null), doQuote())}>
                  Quote reply
                </button>
              )}
              {onSave && c.viewerCanUpdate && (
                <button className="select-menu-item" onClick={() => (setMenu(null), setEditing(true))}>
                  Edit
                </button>
              )}
              {onMinimize && canMinimize && (
                <button className="select-menu-item" onClick={() => act(() => onMinimize(!c.isMinimized))}>
                  {c.isMinimized ? "Unhide" : "Hide as outdated"}
                </button>
              )}
              {onDelete && c.viewerCanDelete && (
                <button
                  className="select-menu-item danger"
                  onClick={() => {
                    setMenu(null);
                    if (confirm("Delete this comment?")) act(onDelete);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </Popover>
        )}
        {copied && <span className="muted copied">Copied</span>}
      </div>
      {editing && onSave ? (
        <div className="comment-edit">
          <Composer
            draftKey={draftKey}
            owner={owner}
            repo={repo}
            initialValue={c.body}
            submitLabel="Update comment"
            autoFocus
            githubUrl={githubUrl}
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              await onSave(body);
              setEditing(false);
            }}
          />
        </div>
      ) : (
        <div className="comment-body" ref={bodyRef}>
          <Markdown html={c.bodyHTML} />
        </div>
      )}
      {error != null && <ErrorBanner error={error} />}
      {!editing && <ReactionBar groups={c.reactionGroups} canReact={c.viewerCanReact !== false} onToggle={onReact} />}
    </div>
  );
}
