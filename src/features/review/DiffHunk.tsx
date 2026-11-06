import { memo, useMemo } from "react";
import { parsePatch } from "@/features/diff/model";

export interface DiffHunkProps {
  hunk: string;
  /** First line of a multi-line comment and its side; the snippet shows exactly that range. */
  startLine?: number | null;
  startSide?: "LEFT" | "RIGHT" | null;
  /** Lines shown, counted from the end, for single-line comments. */
  context?: number;
}

const KIND = { " ": "ctx", "+": "add", "-": "del" } as const;

/** The tail of a review comment's diff hunk, like GitHub's conversation view. */
export const DiffHunk = memo(function DiffHunk({ hunk, startLine, startSide, context = 4 }: DiffHunkProps) {
  const lines = useMemo(() => {
    const all = parsePatch(hunk.replace(/\n$/, "")).flatMap((h) => h.lines);
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
          <tr key={i} className={KIND[l.type]}>
            <td className="num">{l.old || ""}</td>
            <td className="num">{l.new || ""}</td>
            <td className="code">
              <span className="sign">{l.type}</span>
              {l.text}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});
