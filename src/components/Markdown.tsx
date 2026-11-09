import DOMPurify from "dompurify";
import { CheckIcon, CopyIcon } from "@primer/octicons-react";
import { memo, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useNavigate } from "react-router";
import { freshBodyHtml } from "@/api/bodyHtml";
import { copyText } from "@/lib/clipboard";
import { toAppPath } from "@/lib/githubUrl";
import { attachmentUrl, isSignedMedia, signedExpiry } from "@/lib/signedMedia";
import { useDark } from "@/lib/theme";
import { cachedMermaid, renderMermaid } from "@/components/mermaid";

DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName !== "input") return;
  const el = node as Element;
  if (el.getAttribute("type") !== "checkbox" || !el.classList.contains("task-list-item-checkbox")) el.remove();
  else el.setAttribute("disabled", "");
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    const permanent = attachmentUrl(node.getAttribute("href")!);
    if (permanent) node.setAttribute("href", permanent);
    node.setAttribute("rel", "noopener noreferrer");
    if (!node.getAttribute("href")!.startsWith("#")) node.setAttribute("target", "_blank");
  }
  if (node.tagName === "IMG") {
    node.setAttribute("loading", "lazy");
    node.setAttribute("decoding", "async");
  }
});

const PURIFY_CONFIG = {
  ADD_TAGS: ["g-emoji", "details", "summary", "video", "markdown-accessiblity-table", "relative-time"],
  ADD_ATTR: ["alias", "fallback-src", "target", "open", "data-snippet-clipboard-copy-content", "controls", "playsinline", "muted"],
  FORBID_TAGS: ["style", "form", "button", "textarea", "select"],
  ALLOW_DATA_ATTR: false,
};

/** Sanitizes GitHub-rendered HTML. Only disabled task-list checkboxes survive as inputs. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as string;
}

function iconHtml(icon: ReactElement): string {
  const div = document.createElement("div");
  const root = createRoot(div);
  flushSync(() => root.render(icon));
  const html = div.innerHTML;
  root.unmount();
  return html;
}

// Rendered at load: flushSync can't render while React is committing.
const COPY_ICON = iconHtml(<CopyIcon size={16} />);
const CHECK_ICON = iconHtml(<CheckIcon size={16} />);

/** Replaces GitHub's script-filled embeds (Mermaid, GeoJSON, STL) with their source code block. */
function unwrapEnrichments(root: HTMLElement) {
  for (const section of root.querySelectorAll("section.render-needs-enrichment")) {
    const pre = section.querySelector("pre");
    if (pre) section.replaceWith(pre);
    else section.remove();
  }
}

/** Turns `#gh-light-mode-only` / `#gh-dark-mode-only` links into plain spans that markdown.css shows per theme. */
function unwrapThemeLinks(root: HTMLElement) {
  for (const a of root.querySelectorAll('a[href="#gh-light-mode-only"], a[href="#gh-dark-mode-only"]')) {
    const span = document.createElement("span");
    span.className = a.getAttribute("href")!.slice(1);
    span.append(...a.childNodes);
    a.replaceWith(span);
  }
}

/** Draws each Mermaid code block as a diagram, keeping the code block for copying and as a fallback. */
function renderDiagrams(root: HTMLElement, dark: boolean, live: () => boolean) {
  for (const pre of root.querySelectorAll<HTMLElement>('pre[lang="mermaid"]')) {
    const host = pre.closest<HTMLElement>(".code-copy-host");
    if (!host) continue;
    const source = pre.textContent ?? "";
    const show = (svg: string) => {
      let diagram = host.querySelector<HTMLElement>(".mermaid-diagram");
      if (!diagram) {
        diagram = document.createElement("div");
        diagram.className = "mermaid-diagram";
        pre.after(diagram);
      }
      diagram.innerHTML = svg;
      host.classList.add("mermaid-host");
    };
    const cached = cachedMermaid(source, dark);
    if (cached !== undefined) show(cached);
    else
      renderMermaid(source, dark).then(
        (svg) => live() && show(svg),
        (e) => console.warn("Failed to render Mermaid diagram:", e, source),
      );
  }
}

/** Adds a copy button to every code block that lacks one. Buttons are plain DOM, handled by delegation. */
function addCopyButtons(root: HTMLElement) {
  for (const pre of root.querySelectorAll("pre")) {
    let host = pre.closest<HTMLElement>(".snippet-clipboard-content") ?? (pre.parentElement?.classList.contains("highlight") ? pre.parentElement : null);
    if (!host) {
      host = document.createElement("div");
      pre.replaceWith(host);
      host.appendChild(pre);
    }
    if (host.classList.contains("code-copy-host")) continue;
    host.classList.add("code-copy-host");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn sm icon code-copy";
    btn.title = "Copy code";
    btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML = COPY_ICON;
    host.appendChild(btn);
  }
}

function copyBlock(btn: HTMLElement) {
  const host = btn.closest<HTMLElement>(".code-copy-host");
  const text = host?.getAttribute("data-snippet-clipboard-copy-content") ?? host?.querySelector("pre")?.textContent ?? "";
  copyText(text).then(
    () => {
      btn.innerHTML = CHECK_ICON;
      clearTimeout(Number(btn.dataset.timer));
      btn.dataset.timer = String(window.setTimeout(() => (btn.innerHTML = COPY_ICON), 2000));
    },
    (e) => console.error(e),
  );
}

const isMedia = (el: EventTarget | null): el is HTMLImageElement | HTMLVideoElement => el instanceof HTMLImageElement || el instanceof HTMLVideoElement;

/** Margin before a signed link expires within which it counts as expired. */
const EXPIRY_MARGIN_MS = 10_000;

interface MarkdownProps {
  html: string;
  className?: string;
  /** Node id of the comment, issue, or PR whose `bodyHTML` this is. Lets expired attachment links refresh. */
  nodeId?: string;
}

/** Renders GitHub-produced HTML (bodyHTML / body_html), sanitized, with in-app link routing. */
export const Markdown = memo(function Markdown({ html, className, nodeId }: MarkdownProps) {
  const [fresh, setFresh] = useState<{ stale: string; html: string }>();
  const shown = fresh?.stale === html ? fresh.html : html;
  const clean = useMemo(() => sanitizeHtml(shown), [shown]);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const dark = useDark();
  useLayoutEffect(() => {
    if (!ref.current) return;
    unwrapEnrichments(ref.current);
    unwrapThemeLinks(ref.current);
    addCopyButtons(ref.current);
  }, [clean]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    let live = true;
    renderDiagrams(ref.current, dark, () => live);
    return () => {
      live = false;
    };
  }, [clean, dark]);
  // Signed attachment links expire minutes after GitHub renders them, so cached HTML needs a fresh copy.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !nodeId) return;
    const refresh = () => freshBodyHtml(nodeId).then((h) => h && h !== shown && setFresh({ stale: html, html: h }));
    const soon = Date.now() + EXPIRY_MARGIN_MS;
    const media = root.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img, video");
    if ([...media].some((m) => isSignedMedia(m.src) && signedExpiry(m.src) < soon)) refresh();
    const onError = (e: Event) => {
      if (isMedia(e.target) && isSignedMedia(e.target.src)) refresh();
    };
    root.addEventListener("error", onError, true);
    return () => root.removeEventListener("error", onError, true);
  }, [clean, html, shown, nodeId]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const copy = (e.target as HTMLElement).closest<HTMLElement>(".code-copy");
    if (copy) return copyBlock(copy);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!href) return;
    const path = toAppPath(href);
    if (path && /^https?:\/\/(www\.)?github\.com\//.test(href)) {
      e.preventDefault();
      navigate(path);
    }
  };
  if (!clean.trim()) return <div className={`markdown-body muted ${className ?? ""}`}><em>No description provided.</em></div>;
  return <div ref={ref} className={`markdown-body ${className ?? ""}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: clean }} />;
});
