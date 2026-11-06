import DOMPurify from "dompurify";
import { CheckIcon, CopyIcon } from "@primer/octicons-react";
import { memo, useLayoutEffect, useMemo, useRef, type MouseEvent, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useNavigate } from "react-router";
import { copyText } from "@/lib/clipboard";
import { toAppPath } from "@/lib/githubUrl";

DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName !== "input") return;
  const el = node as Element;
  if (el.getAttribute("type") !== "checkbox" || !el.classList.contains("task-list-item-checkbox")) el.remove();
  else el.setAttribute("disabled", "");
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
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

/** Renders GitHub-produced HTML (bodyHTML / body_html), sanitized, with in-app link routing. */
export const Markdown = memo(function Markdown({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) addCopyButtons(ref.current);
  }, [clean]);
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
