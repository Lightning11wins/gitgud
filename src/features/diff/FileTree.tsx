import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CommentIcon,
  FileDiffIcon,
  FileDirectoryFillIcon,
  FileMovedIcon,
  FileAddedIcon,
  FileRemovedIcon,
} from "@primer/octicons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { DiffFile } from "./model";
import { tooltip } from "@/lib/tooltip";

export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
  file?: DiffFile;
}

/** Directory tree of the changed files, single-child directories merged, directories first. */
export function buildTree(files: DiffFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.filename.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = node.children!.find((c) => c.children && c.path === path);
      if (!next) node.children!.push((next = { name: parts[i], path, children: [] }));
      node = next;
    }
    node.children!.push({ name: parts[parts.length - 1], path: f.filename, file: f });
  }
  const finish = (n: TreeNode): TreeNode => {
    if (!n.children) return n;
    let cur = n;
    while (cur !== root && cur.children!.length === 1 && cur.children![0].children) {
      const only = cur.children![0];
      cur = { name: `${cur.name}/${only.name}`, path: only.path, children: only.children };
    }
    const children = cur.children!.map(finish);
    children.sort((a, b) => (!!b.children === !!a.children ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.children ? -1 : 1));
    return { ...cur, children };
  };
  return finish(root);
}

/** Files in tree order, which is the order the diff lists them. */
export function treeOrder(root: TreeNode): DiffFile[] {
  const out: DiffFile[] = [];
  const walk = (n: TreeNode) => {
    if (n.file) out.push(n.file);
    n.children?.forEach(walk);
  };
  walk(root);
  return out;
}

const ROW_H = 28;

interface FlatRow {
  node: TreeNode;
  depth: number;
}

export interface FileTreeProps {
  root: TreeNode;
  active: string | null;
  viewed?: Record<string, string>;
  comments: Map<string, number>;
  onSelect: (path: string) => void;
}

const STATUS_ICON = {
  added: [FileAddedIcon, "var(--success)", "Added"],
  removed: [FileRemovedIcon, "var(--danger)", "Deleted"],
  renamed: [FileMovedIcon, "var(--fg-muted)", "Renamed"],
  copied: [FileMovedIcon, "var(--fg-muted)", "Copied"],
} as const;

export const FileTree = memo(function FileTree({ root, active, viewed, comments, onSelect }: FileTreeProps) {
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const out: FlatRow[] = [];
    const matches = (n: TreeNode): boolean => (n.file ? n.path.toLowerCase().includes(f) : n.children!.some(matches));
    const walk = (n: TreeNode, depth: number) => {
      for (const c of n.children ?? []) {
        if (f && !matches(c)) continue;
        out.push({ node: c, depth });
        if (c.children && (f || !closed.has(c.path))) walk(c, depth + 1);
      }
    };
    walk(root, 0);
    return out;
  }, [root, filter, closed]);

  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 12 });

  const activeIndex = active ? rows.findIndex((r) => r.node.path === active) : -1;
  useEffect(() => {
    const el = scrollRef.current;
    if (activeIndex < 0 || !el) return;
    const top = activeIndex * ROW_H;
    if (top < el.scrollTop || top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top - el.clientHeight / 2;
  }, [activeIndex]);

  return (
    <nav className="ft" aria-label="Changed files">
      <input className="input sm ft-filter" placeholder="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter files" />
      <div className="ft-scroll" ref={scrollRef}>
        {rows.length === 0 && <div className="blankslate">No files match</div>}
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((item) => {
            const { node, depth } = rows[item.index];
            const style = { transform: `translateY(${item.start}px)`, paddingLeft: 8 + depth * 14 };
            if (node.children) {
              const open = !!filter.trim() || !closed.has(node.path);
              return (
                <button
                  key={node.path + "/"}
                  className="ft-row dir"
                  style={style}
                  onClick={() =>
                    setClosed((prev) => {
                      const next = new Set(prev);
                      if (next.has(node.path)) next.delete(node.path);
                      else next.add(node.path);
                      return next;
                    })
                  }
                  title={node.path}
                >
                  {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                  <FileDirectoryFillIcon size={14} className="ft-dir-icon" />
                  <span className="truncate">{node.name}</span>
                </button>
              );
            }
            const f = node.file!;
            const [Icon, color, label] = STATUS_ICON[f.status as keyof typeof STATUS_ICON] ?? [FileDiffIcon, "var(--attention)", "Modified"];
            const count = comments.get(f.filename);
            const isViewed = viewed?.[f.filename] === "VIEWED";
            return (
              <button key={node.path} className={`ft-row file ${node.path === active ? "active" : ""}`} style={style} onClick={() => onSelect(f.filename)} title={f.filename}>
                <span style={{ color, display: "inline-flex" }} role="img" {...tooltip(label, "label")}>
                  <Icon size={14} />
                </span>
                <span className={`truncate grow ${isViewed ? "muted" : ""}`}>{node.name}</span>
                {count ? (
                  <span className="ft-meta">
                    <CommentIcon size={12} />
                    {count}
                  </span>
                ) : null}
                <span className="ft-meta ft-counts">
                  {f.additions > 0 && <span className="add">+{f.additions}</span>}
                  {f.deletions > 0 && <span className="del">-{f.deletions}</span>}
                </span>
                {viewed && <span className="ft-viewed">{isViewed && <CheckIcon size={14} />}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
});
