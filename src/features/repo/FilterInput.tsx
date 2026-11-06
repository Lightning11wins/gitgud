import { useEffect, useState } from "react";
import { SearchIcon } from "@primer/octicons-react";

/** Search-syntax input. Applies on Enter; Escape reverts and blurs. */
export function FilterInput({ value, onApply, placeholder }: { value: string; onApply: (q: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="lr-filter">
      <SearchIcon size={14} />
      <input
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
    </div>
  );
}
