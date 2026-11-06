/** A text edit: replace `[start, end)` with `text`, then select `[selStart, selEnd)`. */
export interface Edit {
  start: number;
  end: number;
  text: string;
  selStart: number;
  selEnd: number;
}

/** Wraps the selection in `before`/`after`, or unwraps it when already wrapped. */
export function wrap(value: string, start: number, end: number, before: string, after = before): Edit {
  const sel = value.slice(start, end);
  if (value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
    return { start: start - before.length, end: end + after.length, text: sel, selStart: start - before.length, selEnd: end - before.length };
  }
  const text = before + sel + after;
  return { start, end, text, selStart: start + before.length, selEnd: start + before.length + sel.length };
}

/** Adds `prefix(i)` to each selected line, or removes it when every line already has it. */
export function prefixLines(value: string, start: number, end: number, prefix: (i: number) => string, match: RegExp): Edit {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end > start && value[end - 1] === "\n" ? end - 1 : end);
  if (lineEnd < 0) lineEnd = value.length;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const remove = lines.every((l) => match.test(l));
  const out = lines.map((l, i) => (remove ? l.replace(match, "") : prefix(i) + l)).join("\n");
  const selStart = start === end ? lineStart + out.length : lineStart;
  return { start: lineStart, end: lineEnd, text: out, selStart, selEnd: lineStart + out.length };
}

export function link(value: string, start: number, end: number): Edit {
  const sel = value.slice(start, end);
  if (/^https?:\/\/\S+$/.test(sel)) return { start, end, text: `[](${sel})`, selStart: start + 1, selEnd: start + 1 };
  const text = `[${sel}](url)`;
  const urlAt = start + sel.length + 3;
  return { start, end, text, selStart: sel ? urlAt : start + 1, selEnd: sel ? urlAt + 3 : start + 1 };
}

export function code(value: string, start: number, end: number): Edit {
  const sel = value.slice(start, end);
  if (!sel.includes("\n")) return wrap(value, start, end, "`");
  const lead = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
  const text = `${lead}\`\`\`\n${sel}${sel.endsWith("\n") ? "" : "\n"}\`\`\`\n`;
  return { start, end, text, selStart: start + lead.length + 4, selEnd: start + lead.length + 4 + sel.length };
}

/** Inserts `text` at the selection, on its own lines when `block` is set. */
export function insert(value: string, start: number, end: number, text: string, block = false): Edit {
  let lead = "";
  if (block && start > 0) lead = value[start - 1] !== "\n" ? "\n\n" : start > 1 && value[start - 2] !== "\n" ? "\n" : "";
  const t = lead + text;
  return { start, end, text: t, selStart: start + t.length, selEnd: start + t.length };
}

export function suggestion(value: string, start: number, end: number, source: string): Edit {
  const body = "```suggestion\n" + source + (source.endsWith("\n") || !source ? "" : "\n") + "```\n";
  return insert(value, start, end, body, true);
}

/** Markdown quote of `text`, ready to append to a reply. */
export function quote(text: string): string {
  return (
    text
      .trim()
      .split("\n")
      .map((l) => (l ? `> ${l}` : ">"))
      .join("\n") + "\n\n"
  );
}

export interface Trigger {
  char: "@" | "#";
  query: string;
  /** Index of the trigger character. */
  start: number;
}

/** The @mention or #reference being typed right before the caret, if any. */
export function findTrigger(value: string, caret: number): Trigger | null {
  const m = /(?:^|[\s([{])([@#])([\w.-]{0,39})$/.exec(value.slice(Math.max(0, caret - 64), caret));
  if (!m) return null;
  return { char: m[1] as "@" | "#", query: m[2], start: caret - m[2].length - 1 };
}
