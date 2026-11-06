import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/**
 * Whether the page is being printed. Virtualized lists use this to render every row,
 * since print layout happens right after `beforeprint` and only sees rows already in the DOM.
 */
export function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    // flushSync commits before the browser lays out the printed pages.
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return printing;
}
