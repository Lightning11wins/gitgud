import DOMPurify, { type WindowLike } from "dompurify";

// Trusted Types policies. The CSP in server/serve.mjs lets only these and DOMPurify's write HTML or load
// scripts, so no other string reaches `innerHTML` or `new Worker` unchecked.

type PolicyFactory = NonNullable<WindowLike["trustedTypes"]>;
const factory = (globalThis as { trustedTypes?: PolicyFactory }).trustedTypes;

function sameOrigin(url: string): string {
  if (new URL(url, location.href).origin !== location.origin) throw new Error(`Failed to load script ${url}: not from this site`);
  return url;
}

// Catches strings that libraries write to HTML and script URL sinks. Scripts from strings stay blocked.
factory?.createPolicy("default", {
  createHTML: (html) => DOMPurify.sanitize(html),
  createScriptURL: sameOrigin,
});

const mermaidPolicy = factory?.createPolicy("gitgud-mermaid", { createHTML: (svg) => svg });

/**
 * Mermaid's rendered SVG, for `innerHTML`. Mermaid sanitizes it in strict mode, and another pass with
 * DOMPurify's defaults would strip parts of diagrams.
 */
export function mermaidHtml(svg: string): string {
  return (mermaidPolicy?.createHTML(svg) ?? svg) as string;
}
