import { useState, type ReactNode } from "react";
import { TriangleDownIcon } from "@primer/octicons-react";
import { tooltip } from "@/lib/tooltip";

/** Caret that forms a split pill with the crumb before it (see `.crumb-split`). `menu` renders while open. */
export function CrumbMenu({ label, menu }: { label: string; menu: (anchor: HTMLElement, close: () => void) => ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        type="button"
        className="crumb-menu"
        {...tooltip(label, "label")}
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <TriangleDownIcon size={16} />
      </button>
      {anchor && menu(anchor, () => setAnchor(null))}
    </>
  );
}
