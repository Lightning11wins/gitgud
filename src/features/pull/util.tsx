import { CheckIcon, CopyIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { tooltip } from "@/lib/tooltip";

export function CopyButton({ text, label = "Copy", size = 14 }: { text: string; label?: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn invisible xs icon pull-copy"
      {...tooltip(copied ? "Copied!" : label, "label")}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        copyText(text).then(() => setCopied(true), () => {});
      }}
    >
      {copied ? <CheckIcon size={size} className="pull-copied" /> : <CopyIcon size={size} />}
    </button>
  );
}

/** A branch name pill like GitHub's, optionally prefixed with the fork owner. */
export function BranchName({ name, owner, href }: { name: string; owner?: string; href?: string }) {
  const text = owner ? `${owner}:${name}` : name;
  return href ? (
    <a className="pull-branch" href={href} target="_blank" rel="noopener noreferrer" title={text}>
      {text}
    </a>
  ) : (
    <span className="pull-branch" title={text}>
      {text}
    </span>
  );
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** Commits grouped by local calendar day, newest group last, like GitHub. */
export function groupByDay<T>(items: T[], date: (item: T) => string): { day: string; items: T[] }[] {
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  const groups: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = fmt.format(new Date(date(item)));
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
