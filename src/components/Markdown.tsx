import DOMPurify from "dompurify";
import { memo, useMemo, type MouseEvent } from "react";
import { useNavigate } from "react-router";
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

/** Renders GitHub-produced HTML (bodyHTML / body_html), sanitized, with in-app link routing. */
export const Markdown = memo(function Markdown({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  const navigate = useNavigate();
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
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
  return <div className={`markdown-body ${className ?? ""}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: clean }} />;
});
