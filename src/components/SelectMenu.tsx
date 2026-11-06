import { CheckIcon } from "@primer/octicons-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Popover } from "./Popover";
import { Spinner } from "./Spinner";

export interface SelectMenuProps<T> {
  anchor: HTMLElement;
  title: string;
  /** Undefined while loading. */
  items: T[] | undefined;
  getKey: (item: T) => string;
  getText: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Keys selected when the menu opened. */
  initial: string[];
  multiple?: boolean;
  /** Called on close with the final keys if they differ from `initial`. Single-select applies on click. */
  onApply: (keys: string[]) => void;
  onClose: () => void;
  /** For server-side filtering; called with the filter text as it changes. */
  onFilterChange?: (text: string) => void;
  footer?: ReactNode;
}

/** GitHub-style filterable picker used for labels, assignees, reviewers, milestones, etc. */
export function SelectMenu<T>(props: SelectMenuProps<T>) {
  const { anchor, title, items, getKey, getText, renderItem, initial, multiple, onApply, onClose, onFilterChange, footer } = props;
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(() => new Set(initial));
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => onFilterChange?.(filter), [filter, onFilterChange]);

  const shown = useMemo(() => {
    if (!items) return [];
    const f = filter.trim().toLowerCase();
    const list = f ? items.filter((i) => getText(i).toLowerCase().includes(f)) : items;
    // Selected items first, like GitHub.
    return [...list.filter((i) => initial.includes(getKey(i))), ...list.filter((i) => !initial.includes(getKey(i)))];
  }, [items, filter, getText, getKey, initial]);

  const close = () => {
    const keys = [...selected];
    const changed = keys.length !== initial.length || keys.some((k) => !initial.includes(k));
    if (multiple && changed) onApply(keys);
    onClose();
  };

  const toggle = (item: T) => {
    const key = getKey(item);
    if (!multiple) {
      if (!initial.includes(key) || initial.length !== 1) onApply([key]);
      else onApply([]);
      onClose();
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) toggle(shown[active]);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Popover anchor={anchor} onClose={close} width={300}>
      <div className="dialog-header" style={{ padding: "8px 12px", fontSize: 13 }}>
        {title}
      </div>
      <div className="select-menu-filter">
        <input
          ref={inputRef}
          className="input sm"
          placeholder="Filter"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="select-menu-list" ref={listRef} role="listbox" aria-multiselectable={multiple}>
        {!items && (
          <div className="blankslate">
            <Spinner label="Loading options" />
          </div>
        )}
        {items && shown.length === 0 && <div className="blankslate">No matches</div>}
        {shown.map((item, i) => {
          const key = getKey(item);
          return (
            <button
              key={key}
              className="select-menu-item"
              data-index={i}
              data-active={i === active}
              role="option"
              aria-selected={selected.has(key)}
              onMouseEnter={() => setActive(i)}
              onClick={() => toggle(item)}
            >
              <span className="check">{selected.has(key) && <CheckIcon />}</span>
              {renderItem(item)}
            </button>
          );
        })}
      </div>
      {footer}
    </Popover>
  );
}
