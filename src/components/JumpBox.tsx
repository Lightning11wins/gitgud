import { ArrowRightIcon, RepoForkedIcon, RepoIcon, RepoLockedIcon } from "@primer/octicons-react";
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { keys } from "@/api/keys";
import { toAppPath } from "@/lib/githubUrl";
import { useHotkey } from "@/lib/hotkeys";
import { tooltip } from "@/lib/tooltip";
import { useDebounced } from "@/lib/useDebounced";
import { Avatar } from "./Avatar";
import { cachedHits, isSearchable, jumpRows, searchJump, type JumpRow, type RepoRef } from "./jumpResults";
import { Spinner } from "./Spinner";
import { StateIcon } from "./StateBadge";
import { TitleText } from "./TitleText";
import "./jump-box.css";

const SEARCH_DELAY_MS = 300;

const jumpQuery = (repo: RepoRef | null, text: string) =>
  queryOptions({
    queryKey: keys.jump(repo, text),
    queryFn: () => searchJump(text, repo),
    staleTime: 5 * 60_000,
    persister: undefined,
    retry: false,
  });

/** Header box that suggests pages as you type; Enter opens the highlighted one. */
export function JumpBox({ repo }: { repo: RepoRef | null }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [invalid, setInvalid] = useState(false);

  const [waiting, setWaiting] = useState(false);
  useHotkey("/", () => ref.current?.focus());

  const text = value.trim();
  const textRef = useRef(text);
  textRef.current = text;
  const debounced = useDebounced(text, SEARCH_DELAY_MS);
  const live = useQuery({
    ...jumpQuery(repo, debounced),
    enabled: isSearchable(debounced) && focused,
    placeholderData: keepPreviousData,
  });

  const rows = text ? suggestions() : [];
  const shown = focused && !dismissed ? rows : [];

  function suggestions() {
    const cached = cachedHits(client);
    if (!live.data) return jumpRows(text, repo, cached);
    if (!live.isPlaceholderData && debounced === text) return jumpRows(text, repo, cached, live.data);
    // Results for older text join the cached hits, so only the ones that still match show.
    const old = live.data;
    return jumpRows(text, repo, { repos: [...cached.repos, ...old.repos], owners: [...cached.owners, ...old.owners], subjects: [...cached.subjects, ...old.subjects] });
  }

  const reset = () => {
    setValue("");
    setActive(0);
    ref.current?.blur();
  };
  const go = (row: JumpRow | undefined) => {
    if (!row) {
      setInvalid(true);
      return;
    }
    reset();
    navigate(row.path);
  };
  /** Opens the highlighted row. With none yet, searches now and opens the top result, unless the text changed meanwhile. */
  const enter = async () => {
    const row = rows[active] ?? rows[0];
    if (row || !isSearchable(text)) return go(row);
    const asked = text;
    setWaiting(true);
    const hits = await client.fetchQuery(jumpQuery(repo, asked)).catch(() => undefined);
    setWaiting(false);
    if (textRef.current === asked && document.activeElement === ref.current) go(jumpRows(asked, repo, cachedHits(client), hits)[0]);
  };

  return (
    <div className="jump-box">
      <input
        ref={ref}
        className="input sm"
        style={invalid ? { borderColor: "var(--danger)" } : undefined}
        placeholder="Jump to…"
        {...tooltip(repo ? "Type #123, a title, a repo, or a user, or paste a GitHub URL. Shortcut: /" : "Type a repo or user, owner/repo#123, or paste a GitHub URL. Shortcut: /")}
        aria-label="Jump to an issue, pull request, repository, or user"
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDismissed(false);
        }}
        onChange={(e) => {
          setValue(e.target.value);
          setActive(0);
          setDismissed(false);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (dismissed) setDismissed(false);
            else setActive((a) => Math.max(0, Math.min(a + (e.key === "ArrowDown" ? 1 : -1), shown.length - 1)));
          } else if (e.key === "Enter") {
            void enter();
          } else if (e.key === "Escape") {
            if (shown.length) setDismissed(true);
            else ref.current?.blur();
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          const path = toAppPath(text);
          if (path && /github\.com\//.test(text)) {
            e.preventDefault();
            reset();
            navigate(path);
          }
        }}
      />
      {!value && <kbd aria-hidden="true">/</kbd>}
      {value && <Spinner label="Searching GitHub" show={live.isFetching || waiting} />}
      {shown.length > 0 && (
        <div className="jump-menu popover" id={listId} role="listbox" aria-label="Suggestions">
          {shown.map((row, i) => (
            <Link
              key={row.path}
              id={`${listId}-${i}`}
              to={row.path}
              className="select-menu-item"
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) reset();
              }}
            >
              <RowContent row={row} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function RowContent({ row }: { row: JumpRow }) {
  switch (row.kind) {
    case "jump":
      return (
        <>
          <ArrowRightIcon className="muted" />
          <span className="truncate">{row.label}</span>
          <span className="jump-hint muted">Jump to</span>
        </>
      );
    case "repo": {
      const Icon = row.visibility === "PRIVATE" ? RepoLockedIcon : row.isFork ? RepoForkedIcon : RepoIcon;
      return (
        <>
          <Icon className="muted" />
          <span className="truncate">
            <span className="muted">{row.owner}/</span>
            {row.name}
          </span>
        </>
      );
    }
    case "owner":
      return (
        <>
          <Avatar src={row.avatarUrl} size={16} login={row.login} />
          <span className="truncate">{row.login}</span>
        </>
      );
    case "subject":
      return (
        <>
          <StateIcon kind={row.isPull ? "pull" : "issue"} state={row.state} stateReason={row.stateReason} isDraft={row.isDraft} />
          <span className="truncate">
            <TitleText text={row.title} />
          </span>
          <span className="jump-hint muted">#{row.number}</span>
        </>
      );
  }
}
