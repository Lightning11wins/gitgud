type Mermaid = (typeof import("mermaid"))["default"];

let lib: Promise<Mermaid> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;
const pending = new Map<string, Promise<string>>();
const done = new Map<string, string>();

const cacheKey = (source: string, dark: boolean) => `${dark ? "dark" : "light"}\n${source}`;

/** SVG already rendered for a Mermaid diagram in this theme. */
export function cachedMermaid(source: string, dark: boolean): string | undefined {
  return done.get(cacheKey(source, dark));
}

/** Renders a Mermaid diagram to SVG, once per source and theme. Loads Mermaid on first use. */
export function renderMermaid(source: string, dark: boolean): Promise<string> {
  const key = cacheKey(source, dark);
  let svg = pending.get(key);
  if (svg) return svg;
  // Renders run one at a time because `initialize` sets the theme globally.
  svg = queue.then(async () => {
    const mermaid = await (lib ??= import("mermaid").then((m) => m.default));
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: dark ? "dark" : "default",
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    const { svg } = await mermaid.render(`gitgud-mermaid-${nextId++}`, source);
    done.set(key, svg);
    return svg;
  });
  queue = svg.catch(() => {});
  pending.set(key, svg);
  return svg;
}
