import type { CSSProperties } from "react";
import type { Label } from "@/api/types";

/** A label pill colored like GitHub's: tinted background with readable text in both themes. */
export function IssueLabel({ label, onClick }: { label: Pick<Label, "name" | "color" | "description">; onClick?: () => void }) {
  const [r, g, b] = hexToRgb(label.color);
  const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
  const style = {
    "--label-r": r,
    "--label-g": g,
    "--label-b": b,
    "--label-l": lightness,
  } as CSSProperties;
  return (
    <span className="label issue-label" style={style} title={label.description ?? undefined} onClick={onClick}>
      {label.name}
    </span>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
