import { useEffect } from "react";

/** Sets the browser tab title to the given parts joined with " · ", ending in "GitGud". Empty parts are skipped. */
export function useTitle(...parts: (string | number | null | undefined | false)[]) {
  const title = [...parts.filter((p) => p || p === 0), "GitGud"].join(" · ");
  useEffect(() => {
    document.title = title;
  }, [title]);
}
