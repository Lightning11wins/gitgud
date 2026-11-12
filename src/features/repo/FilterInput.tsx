import { useEffect, useRef, useState } from "react";
import { SearchIcon, XCircleFillIcon } from "@primer/octicons-react";
import { tooltip } from "@/lib/tooltip";

/** Search-syntax input. Applies on Enter; Escape reverts and blurs; the clear button applies an empty search. */
export function FilterInput({ value, onApply, placeholder }: { value: string; onApply: (q: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="lr-filter">
      <SearchIcon size={14} />
      <input
        ref={inputRef}
        className="input"
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        aria-label="Search all issues and pull requests"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onApply(draft.trim());
          if (e.key === "Escape") {
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
      />
      {draft && (
        <button
          className="btn invisible sm icon lr-filter-clear"
          {...tooltip("Clear search", "label")}
          onClick={() => {
            setDraft("");
            onApply("");
            inputRef.current?.focus();
          }}
        >
          <XCircleFillIcon size={16} />
        </button>
      )}
    </div>
  );
}
