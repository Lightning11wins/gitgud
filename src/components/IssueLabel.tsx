import type { CSSProperties } from "react";
import type { Label } from "@/api/types";

/** A label pill colored like GitHub's: tinted background with readable text in both themes. */
export function IssueLabel({ label, onClick }: { label: Pick<Label, "name" | "color" | "description">; onClick?: () => void }) {
  const [r, g, b] = hexToRgb(label.color);
  const [h, sat, lum] = rgbToHsl(r, g, b);
  const style = {
    "--label-r": r,
    "--label-g": g,
    "--label-b": b,
    "--label-h": h,
    "--label-s": sat,
    "--label-l": lum,
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

/** Hue in degrees, saturation and lightness in percent. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [rf, gf, bf] = [r / 255, g / 255, b / 255];
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rf ? ((gf - bf) / d + 6) % 6 : max === gf ? (bf - rf) / d + 2 : (rf - gf) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}
