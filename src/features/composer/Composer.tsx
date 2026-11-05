import { useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { drafts } from "@/lib/drafts";

export interface ComposerActionContext {
  value: string;
  submitting: boolean;
  /** Runs `fn` with the current text, showing progress and errors, and clears the draft on success. */
  run: (fn: (body: string) => Promise<void>) => Promise<void>;
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
}

/** Markdown comment editor with persistent drafts. Ctrl/Cmd+Enter submits. */
export function Composer(props: ComposerProps) {
  const { draftKey, initialValue = "", placeholder = "Leave a comment", submitLabel = "Comment", onSubmit, onCancel, autoFocus, minRows = 4, allowEmpty, actions } = props;
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    drafts.get(draftKey).then((d) => {
      if (cancelled) return;
      if (d) setValue(d);
      loaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => drafts.set(draftKey, value === initialValue ? "" : value), 250);
    return () => clearTimeout(t);
  }, [draftKey, value, initialValue]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const run = async (fn: (body: string) => Promise<void>) => {
    setSubmitting(true);
    setError(null);
    try {
      await fn(value);
      await drafts.clear(draftKey);
      setValue("");
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !submitting && (allowEmpty || value.trim().length > 0);

  return (
    <div className="composer">
      <textarea
        ref={ref}
        className="input composer-input"
        rows={minRows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSubmit) {
            e.preventDefault();
            run(onSubmit);
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
        style={{ width: "100%" }}
      />
      {error != null && <ErrorBanner error={error} />}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
        {onCancel && (
          <button className="btn" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
        {actions?.({ value, submitting, run })}
        <button className="btn primary" disabled={!canSubmit} onClick={() => run(onSubmit)}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
