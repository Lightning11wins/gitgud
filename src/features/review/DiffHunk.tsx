import { memo, useMemo } from "react";

export interface HunkLine {
  kind: "ctx" | "add" | "del";
  old: number | null;
  new: number | null;
  text: string;
}

/** Parses a unified diff hunk (as in `diffHunk`) into numbered lines. */
export function parseHunk(hunk: string): HunkLine[] {
  const out: HunkLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of hunk.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      continue;
    }
    const sign = raw[0];
    const text = raw.slice(1);
    if (sign === "+") out.push({ kind: "add", old: null, new: newNo++, text });
    else if (sign === "-") out.push({ kind: "del", old: oldNo++, new: null, text });
    else if (sign === " " || raw === "") out.push({ kind: "ctx", old: oldNo++, new: newNo++, text });
  }
  // A trailing newline leaves one empty context line that isn't in the diff.
  if (out.length && hunk.endsWith("\n")) out.pop();
  return out;
}

export interface DiffHunkProps {
  hunk: string;
  /** First line of a multi-line comment and its side; the snippet shows exactly that range. */
  startLine?: number | null;
  startSide?: "LEFT" | "RIGHT" | null;
  /** Lines shown, counted from the end, for single-line comments. */
  context?: number;
}

/** The tail of a review comment's diff hunk, like GitHub's conversation view. */
export const DiffHunk = memo(function DiffHunk({ hunk, startLine, startSide, context = 4 }: DiffHunkProps) {
  const lines = useMemo(() => {
    const all = parseHunk(hunk);
    let from = Math.max(0, all.length - context);
    if (startLine != null) {
      const i = all.findIndex((l) => (startSide === "LEFT" ? l.old : l.new) === startLine);
      if (i >= 0) from = i;
    }
    return all.slice(from);
  }, [hunk, startLine, startSide, context]);
  if (!lines.length) return null;
  return (
    <table className="rt-hunk">
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className={l.kind}>
            <td className="num">{l.old ?? ""}</td>
            <td className="num">{l.new ?? ""}</td>
            <td className="code">
              <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}</span>
              {l.text}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});
