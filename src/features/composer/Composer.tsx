import {
  BoldIcon,
  CodeIcon,
  CrossReferenceIcon,
  FileDiffIcon,
  HeadingIcon,
  ImageIcon,
  ItalicIcon,
  LinkExternalIcon,
  LinkIcon,
  ListOrderedIcon,
  ListUnorderedIcon,
  MentionIcon,
  QuoteIcon,
  TasklistIcon,
  XIcon,
} from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { rest } from "@/api/client";
import { Avatar } from "@/components/Avatar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Markdown } from "@/components/Markdown";
import { Spinner } from "@/components/Spinner";
import { StateIcon } from "@/components/StateBadge";
import { drafts } from "@/lib/drafts";
import { useMentionSuggestions, useRefSuggestions, type MentionCandidate, type RefCandidate } from "./autocomplete";
import { code, findTrigger, insert, link, prefixLines, suggestion, wrap, type Edit, type Trigger } from "./format";
import "./composer.css";

export interface ComposerActionContext {
  value: string;
  submitting: boolean;
  /** Runs `fn` with the current text, showing progress and errors, and clears the draft on success. */
  run: (fn: (body: string) => Promise<void>) => Promise<void>;
}

/** Imperative controls, e.g. for quote-reply and the `r` hotkey. */
export interface ComposerHandle {
  focus: () => void;
  /** Appends `text` on its own paragraph and focuses the editor. */
  append: (text: string) => void;
}

export interface ComposerProps {
  /** Drafts store key, e.g. `owner/repo#12:comment`. Unsent text survives reloads. */
  draftKey: string;
  owner: string;
  repo: string;
  /** Starting text when no draft exists, e.g. the current body when editing. */
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
  minRows?: number;
  /** Allow submitting empty text (e.g. approving a review without a body). */
  allowEmpty?: boolean;
  /** Extra buttons left of the submit button, e.g. "Close with comment". */
  actions?: (ctx: ComposerActionContext) => ReactNode;
  /** github.com URL of the issue/PR, used by the image-paste fallback. */
  githubUrl?: string;
  /** Original code for the "suggest change" button on inline review comments. */
  suggestionSource?: string;
  handle?: Ref<ComposerHandle>;
  /** Hides the submit row; for forms that submit the text themselves (e.g. new issue). */
  hideSubmit?: boolean;
  /** Called on every change, e.g. by forms that read the text. */
  onChange?: (value: string) => void;
}

type Suggestion = { kind: "@"; item: MentionCandidate } | { kind: "#"; item: RefCandidate };

/** Markdown comment editor with persistent drafts, preview, toolbar, and @/# autocomplete. Ctrl/Cmd+Enter submits. */
export function Composer(props: ComposerProps) {
  const { draftKey, owner, repo, initialValue = "", placeholder = "Leave a comment", submitLabel = "Comment", onSubmit, onCancel, autoFocus, minRows = 4 } = props;
  const { allowEmpty, actions, githubUrl, suggestionSource, handle, hideSubmit, onChange } = props;
  const [value, setValueState] = useState(initialValue);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [imageNotice, setImageNotice] = useState(false);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const loaded = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /** Counts edits so a draft that loads after the user started typing doesn't replace their text. */
  const edits = useRef(0);
  const setValue = (v: string) => {
    edits.current++;
    setValueState(v);
    onChangeRef.current?.(v);
  };

  const loadedKey = useRef(draftKey);
  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    // A new key (e.g. navigating to another issue) must not keep the previous key's text.
    const reset = loadedKey.current !== draftKey;
    loadedKey.current = draftKey;
    const editsAtStart = edits.current;
    drafts.get(draftKey).then((d) => {
      if (cancelled) return;
      loaded.current = true;
      if (edits.current !== editsAtStart) {
        const v = valueRef.current;
        drafts.setSoon(draftKey, v === initialValue ? "" : v);
      } else if (d || reset) {
        setValueState(d ?? initialValue);
        onChangeRef.current?.(d ?? initialValue);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  useEffect(() => {
    if (loaded.current) drafts.setSoon(draftKey, value === initialValue ? "" : value);
  }, [draftKey, value, initialValue]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || FIELD_SIZING) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [value, tab]);

  useImperativeHandle(handle, () => ({
    focus: () => {
      setTab("write");
      requestAnimationFrame(() => ref.current?.focus());
    },
    append: (text: string) => {
      setTab("write");
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        const v = valueRef.current;
        applyEdit(insert(v, v.length, v.length, text, v.trim().length > 0));
      });
    },
  }));

  /** Applies an edit through the browser's editing stack so Ctrl+Z works. */
  const applyEdit = (edit: Edit) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(edit.start, edit.end);
    if (!document.execCommand("insertText", false, edit.text)) {
      const v = el.value;
      setValue(v.slice(0, edit.start) + edit.text + v.slice(edit.end));
    }
    requestAnimationFrame(() => el.setSelectionRange(edit.selStart, edit.selEnd));
  };

  const format = (op: (v: string, s: number, e: number) => Edit) => {
    const el = ref.current;
    if (!el) return;
    if (tab !== "write") setTab("write");
    applyEdit(op(el.value, el.selectionStart, el.selectionEnd));
  };

  const run = async (fn: (body: string) => Promise<void>) => {
    setSubmitting(true);
    setError(null);
    try {
      await fn(valueRef.current);
      await drafts.clear(draftKey);
      setValue("");
      setTab("write");
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = () => {
    if (value.trim() && value !== initialValue && !confirm("Discard your unsaved changes?")) return;
    drafts.clear(draftKey);
    onCancel?.();
  };

  const canSubmit = !submitting && (allowEmpty || value.trim().length > 0);

  const mentionQuery = trigger?.char === "@" ? trigger.query : null;
  const refQuery = trigger?.char === "#" ? trigger.query : null;
  const mentions = useMentionSuggestions(owner, repo, mentionQuery);
  const refs = useRefSuggestions(owner, repo, refQuery);
  const suggestions: Suggestion[] | undefined =
    trigger?.char === "@" ? mentions?.map((item) => ({ kind: "@", item })) : trigger?.char === "#" ? refs?.map((item) => ({ kind: "#", item })) : undefined;

  const updateTrigger = () => {
    const el = ref.current;
    if (!el || el.selectionStart !== el.selectionEnd) return setTrigger(null);
    const t = findTrigger(el.value, el.selectionStart);
    setTrigger((prev) => (prev?.start === t?.start && prev?.query === t?.query && prev?.char === t?.char ? prev : t));
    if (t?.start !== trigger?.start) setActive(0);
  };

  const accept = (s: Suggestion) => {
    const el = ref.current;
    if (!el || !trigger) return;
    const text = s.kind === "@" ? `@${s.item.login} ` : `#${s.item.number} `;
    applyEdit({ start: trigger.start, end: el.selectionStart, text, selStart: trigger.start + text.length, selEnd: trigger.start + text.length });
    setTrigger(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (suggestions?.length && trigger) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = suggestions.length;
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !mod) {
        e.preventDefault();
        accept(suggestions[Math.min(active, suggestions.length - 1)]);
        return;
      }
    }
    if (e.key === "Escape" && trigger) {
      e.preventDefault();
      e.stopPropagation();
      setTrigger(null);
      return;
    }
    if (e.key === "Enter" && mod) {
      e.preventDefault();
      if (canSubmit && !hideSubmit) run(onSubmit);
      return;
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const op = k === "b" ? fmtBold : k === "i" ? fmtItalic : k === "k" ? link : k === "e" ? code : null;
      if (op) {
        e.preventDefault();
        format(op);
        return;
      }
    }
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      cancel();
    }
  };

  const hasImage = (files: FileList | undefined | null) => !!files && [...files].some((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
  const onPaste = (e: ClipboardEvent) => {
    if (hasImage(e.clipboardData?.files)) {
      e.preventDefault();
      setImageNotice(true);
    }
  };
  const onDrop = (e: DragEvent) => {
    if (e.dataTransfer?.files?.length) {
      e.preventDefault();
      setImageNotice(true);
    }
  };

  const tools: [string, ReactNode, (v: string, s: number, e: number) => Edit][] = [
    ["Heading", <HeadingIcon />, (v, s, e) => prefixLines(v, s, e, () => "### ", /^#{1,6} /)],
    ["Bold (Ctrl+B)", <BoldIcon />, fmtBold],
    ["Italic (Ctrl+I)", <ItalicIcon />, fmtItalic],
    ["Quote", <QuoteIcon />, (v, s, e) => prefixLines(v, s, e, () => "> ", /^> ?/)],
    ["Code (Ctrl+E)", <CodeIcon />, code],
    ["Link (Ctrl+K)", <LinkIcon />, link],
    ["Bulleted list", <ListUnorderedIcon />, (v, s, e) => prefixLines(v, s, e, () => "- ", /^[-*] (?!\[[ x]\] )/)],
    ["Numbered list", <ListOrderedIcon />, (v, s, e) => prefixLines(v, s, e, (i) => `${i + 1}. `, /^\d+\. /)],
    ["Task list", <TasklistIcon />, (v, s, e) => prefixLines(v, s, e, () => "- [ ] ", /^[-*] \[[ x]\] /)],
    ["Mention", <MentionIcon />, (v, s, e) => mentionEdit(v, s, e, "@")],
    ["Reference an issue or pull request", <CrossReferenceIcon />, (v, s, e) => mentionEdit(v, s, e, "#")],
  ];

  return (
    <div className="composer" onDrop={onDrop} onDragOver={(e) => e.dataTransfer?.types.includes("Files") && e.preventDefault()}>
      <div className="composer-head">
        <div className="composer-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "write"} className={`composer-tab${tab === "write" ? " active" : ""}`} onClick={() => setTab("write")}>
            Write
          </button>
          <button role="tab" aria-selected={tab === "preview"} className={`composer-tab${tab === "preview" ? " active" : ""}`} onClick={() => setTab("preview")}>
            Preview
          </button>
        </div>
        {tab === "write" && (
          <div className="composer-toolbar" role="toolbar">
            {suggestionSource !== undefined && (
              <button className="btn invisible sm" title="Suggest change" onMouseDown={(e) => e.preventDefault()} onClick={() => format((v, s, e) => suggestion(v, s, e, suggestionSource))}>
                <FileDiffIcon /> Suggest
              </button>
            )}
            {tools.map(([title, icon, op]) => (
              <button key={title} className="btn invisible sm icon" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={() => {
                format(op);
                if (title === "Mention" || title.startsWith("Reference")) requestAnimationFrame(updateTrigger);
              }}>
                {icon}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="composer-body">
        {tab === "write" ? (
          <>
            <textarea
              ref={ref}
              className="input composer-input"
              rows={minRows}
              style={{ minHeight: `calc(${minRows}lh + 18px)` }}
              placeholder={placeholder}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                requestAnimationFrame(updateTrigger);
              }}
              onKeyDown={onKeyDown}
              onKeyUp={(e) => (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") && updateTrigger()}
              onClick={updateTrigger}
              onBlur={() => setTimeout(() => setTrigger(null), 150)}
              onPaste={onPaste}
            />
            {trigger && suggestions && suggestions.length > 0 && (
              <SuggestionList textarea={ref.current} trigger={trigger} suggestions={suggestions} active={Math.min(active, suggestions.length - 1)} onPick={accept} onHover={setActive} />
            )}
          </>
        ) : (
          <Preview owner={owner} repo={repo} text={value} minRows={minRows} />
        )}
      </div>
      {imageNotice && (
        <div className="flash info composer-notice row">
          <ImageIcon />
          <span className="grow">GitHub's API can't upload files. Attach it on GitHub, then paste the link here.</span>
          {githubUrl && (
            <a className="btn sm" href={githubUrl} target="_blank" rel="noopener noreferrer">
              <LinkExternalIcon /> Open on GitHub
            </a>
          )}
          <button className="btn invisible sm icon" aria-label="Dismiss" onClick={() => setImageNotice(false)}>
            <XIcon />
          </button>
        </div>
      )}
      {error != null && <ErrorBanner error={error} />}
      {!hideSubmit && (
        <div className="composer-actions row">
          <span className="grow muted composer-hint">Markdown supported · Ctrl+Enter to submit</span>
          {onCancel && (
            <button className="btn" onClick={cancel} disabled={submitting}>
              Cancel
            </button>
          )}
          {actions?.({ value, submitting, run })}
          <button className="btn primary" disabled={!canSubmit} onClick={() => run(onSubmit)}>
            {submitting && <Spinner size={12} label="Submitting" />}
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/** Browsers that grow the textarea to fit its text in CSS; others resize it on input. */
const FIELD_SIZING = typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");

const fmtBold = (v: string, s: number, e: number) => wrap(v, s, e, "**");
const fmtItalic = (v: string, s: number, e: number) => wrap(v, s, e, "_");

function mentionEdit(v: string, s: number, e: number, char: string): Edit {
  const lead = s > 0 && !/\s/.test(v[s - 1]) ? " " : "";
  return insert(v, s, e, lead + char);
}

function Preview({ owner, repo, text, minRows }: { owner: string; repo: string; text: string; minRows: number }) {
  const q = useQuery({
    queryKey: ["markdown-preview", owner, repo, text],
    queryFn: () => rest<string>("/markdown", { method: "POST", body: { text, mode: "gfm", context: `${owner}/${repo}` }, text: true }),
    enabled: text.trim().length > 0,
    staleTime: Infinity,
    gcTime: 60_000,
    persister: undefined,
  });
  return (
    <div className="composer-preview" style={{ minHeight: minRows * 21 + 18 }}>
      {!text.trim() ? (
        <span className="muted">Nothing to preview</span>
      ) : q.isPending ? (
        <Spinner label="Rendering preview" />
      ) : q.error ? (
        <ErrorBanner error={q.error} />
      ) : (
        <Markdown html={q.data ?? ""} />
      )}
    </div>
  );
}

/** Pixel position of the caret at `pos` inside `el`, via an offscreen mirror element. */
function caretPosition(el: HTMLTextAreaElement, pos: number): { top: number; left: number } {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const p of ["boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingLeft", "paddingRight", "borderTopWidth", "borderLeftWidth", "tabSize"] as const) {
    mirror.style[p] = style[p];
  }
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
  mirror.textContent = el.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop - el.scrollTop;
  const left = marker.offsetLeft;
  mirror.remove();
  return { top, left };
}

function SuggestionList(props: {
  textarea: HTMLTextAreaElement | null;
  trigger: Trigger;
  suggestions: Suggestion[];
  active: number;
  onPick: (s: Suggestion) => void;
  onHover: (i: number) => void;
}) {
  const { textarea, trigger, suggestions, active, onPick, onHover } = props;
  if (!textarea) return null;
  const pos = caretPosition(textarea, trigger.start);
  const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 21;
  const top = Math.min(pos.top + lineHeight + 4, textarea.clientHeight + 4);
  const left = Math.min(pos.left, Math.max(0, textarea.clientWidth - 300));
  return (
    <div className="composer-suggest popover" style={{ position: "absolute", top, left }} role="listbox">
      {suggestions.map((s, i) => (
        <button
          key={s.kind === "@" ? s.item.login : s.item.number}
          role="option"
          aria-selected={i === active}
          data-active={i === active}
          className="select-menu-item"
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(s)}
        >
          {s.kind === "@" ? (
            <>
              <Avatar src={s.item.avatarUrl} size={20} login={s.item.login} />
              <strong>{s.item.login}</strong>
              {s.item.name && <span className="muted truncate">{s.item.name}</span>}
            </>
          ) : (
            <>
              <StateIcon kind={s.item.__typename === "PullRequest" ? "pull" : "issue"} state={s.item.state} stateReason={s.item.stateReason} isDraft={s.item.isDraft} />
              <span className="muted">#{s.item.number}</span>
              <span className="truncate">{s.item.title}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
