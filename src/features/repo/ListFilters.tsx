import { useMemo, useState } from "react";
import { SortDescIcon, TriangleDownIcon } from "@primer/octicons-react";
import { Avatar } from "@/components/Avatar";
import { SelectMenu } from "@/components/SelectMenu";
import { useAssignableUsers, useIssueTypes, useMilestones, useRepoLabels } from "@/features/sidebar/data";
import type { Label } from "@/api/types";
import { getQualifier, setQualifier, setSort, type ListItem } from "./searchList";

export const DEFAULT_SORT = "created-desc";
const SORTS = [
  { value: "created-desc", label: "Newest" },
  { value: "created-asc", label: "Oldest" },
  { value: "updated-desc", label: "Recently updated" },
  { value: "comments-desc", label: "Most commented" },
  { value: "relevance-desc", label: "Best match" },
];
const SORT_ALIASES: Record<string, string> = { relevance: "relevance-desc" };

/** The Labels menu's "No labels" row, which stands for `no:label`. */
const NO_LABEL: Label = { id: "no:label", name: "no:label", color: "", description: null };

const REVIEWS = [
  { value: "none", label: "No reviews" },
  { value: "required", label: "Review required" },
  { value: "approved", label: "Approved" },
  { value: "changes_requested", label: "Changes requested" },
];

type Qualifier = "author" | "label" | "milestone" | "assignee" | "type" | "review";
type Menu = Qualifier | "sort";

interface Person {
  login: string;
  avatarUrl?: string;
}

export interface ListFiltersProps {
  owner: string;
  repo: string;
  kind?: "issue" | "pr";
  q: string;
  setQ: (q: string) => void;
  sort: string;
  /** Loaded rows, whose authors fill the Author menu. */
  items: ListItem[] | undefined;
}

/** Author, Labels, Milestones, Assignees, Types or Reviews, and Sort menus that edit the search query. */
export function ListFilters({ owner, repo, kind, q, setQ, sort, items }: ListFiltersProps) {
  const [menu, setMenu] = useState<{ which: Menu; anchor: HTMLElement } | null>(null);
  const [authorText, setAuthorText] = useState("");
  const labels = useRepoLabels(owner, repo, menu?.which === "label");
  const milestones = useMilestones(owner, repo, menu?.which === "milestone");
  const assignable = useAssignableUsers(owner, repo, menu?.which === "assignee");
  const types = useIssueTypes(owner, repo, menu?.which === "type");

  const authors = useMemo(() => {
    const seen = new Map<string, Person>();
    for (const login of getQualifier(q, "author")) seen.set(login.toLowerCase(), { login });
    for (const i of items ?? []) if (i.author && !seen.has(i.author.login.toLowerCase())) seen.set(i.author.login.toLowerCase(), i.author);
    const typed = authorText.trim().replace(/^@(?!me$)/, "");
    const list = [...seen.values()];
    return typed && !seen.has(typed.toLowerCase()) ? [{ login: typed }, ...list] : list;
  }, [q, items, authorText]);

  const toggle = (which: Menu) => (e: React.MouseEvent<HTMLElement>) =>
    setMenu(menu?.which === which ? null : { which, anchor: e.currentTarget });

  const noLabel = getQualifier(q, "no").some((v) => v.toLowerCase() === "label");

  const button = (which: Qualifier, label: string) => (
    <button
      className="btn invisible sm rf-btn"
      data-active={getQualifier(q, which).length > 0 || (which === "label" && noLabel)}
      aria-expanded={menu?.which === which}
      onClick={toggle(which)}
    >
      {label}
      <TriangleDownIcon size={16} />
    </button>
  );

  const menuProps = (which: Qualifier, anchor: HTMLElement) => ({
    anchor,
    initial: getQualifier(q, which),
    onApply: (values: string[]) => setQ(setQualifier(q, which, values)),
    onClose: () => setMenu(null),
  });

  const sortValue = SORT_ALIASES[sort] ?? sort;
  const sortLabel = SORTS.find((s) => s.value === sortValue)?.label ?? sort;

  const applyLabels = (values: string[]) => {
    const others = getQualifier(q, "no").filter((v) => v.toLowerCase() !== "label");
    const no = values.includes(NO_LABEL.name) ? [...others, "label"] : others;
    setQ(setQualifier(setQualifier(q, "label", values.filter((v) => v !== NO_LABEL.name)), "no", no));
  };

  return (
    <div className="rf">
      {button("author", "Author")}
      {button("label", "Labels")}
      {button("milestone", "Milestones")}
      {button("assignee", "Assignees")}
      {kind === "issue" && button("type", "Types")}
      {kind === "pr" && button("review", "Reviews")}
      <button className="btn invisible sm rf-btn" aria-expanded={menu?.which === "sort"} onClick={toggle("sort")}>
        <SortDescIcon size={16} />
        {sortLabel}
        <TriangleDownIcon size={16} />
      </button>

      {menu?.which === "author" && (
        <SelectMenu<Person>
          {...menuProps("author", menu.anchor)}
          title="Filter by author"
          items={authors}
          getKey={(p) => p.login}
          getText={(p) => p.login}
          renderItem={(p) => (
            <>
              {p.avatarUrl && <Avatar src={p.avatarUrl} login={p.login} size={20} />}
              <span className="truncate">{p.login}</span>
            </>
          )}
          onFilterChange={setAuthorText}
          emptyText="Type a username"
        />
      )}
      {menu?.which === "label" && (
        <SelectMenu
          {...menuProps("label", menu.anchor)}
          initial={noLabel ? [NO_LABEL.name, ...getQualifier(q, "label")] : getQualifier(q, "label")}
          onApply={applyLabels}
          title="Filter by label"
          items={labels.data && [NO_LABEL, ...labels.data]}
          getKey={(l) => l.name}
          getText={(l) => (l === NO_LABEL ? "No labels" : `${l.name} ${l.description ?? ""}`)}
          renderItem={(l) =>
            l === NO_LABEL ? (
              <span className="row rf-name">
                <span className="rf-dot" />
                No labels
              </span>
            ) : (
              <span className="rf-item">
                <span className="row rf-name">
                  <span className="rf-dot" style={{ background: `#${l.color}` }} />
                  <span className="truncate">{l.name}</span>
                </span>
                {l.description && <span className="muted truncate">{l.description}</span>}
              </span>
            )
          }
          multiple
          emptyText={labels.error ? "Failed to load labels" : "No labels"}
        />
      )}
      {menu?.which === "milestone" && (
        <SelectMenu
          {...menuProps("milestone", menu.anchor)}
          title="Filter by milestone"
          items={milestones.data}
          getKey={(m) => m.title}
          getText={(m) => m.title}
          renderItem={(m) => (
            <span className="rf-item">
              <strong className="truncate">{m.title}</strong>
              {m.dueOn && <span className="muted">Due {new Date(m.dueOn).toLocaleDateString()}</span>}
            </span>
          )}
          emptyText={milestones.error ? "Failed to load milestones" : "No open milestones"}
        />
      )}
      {menu?.which === "assignee" && (
        <SelectMenu
          {...menuProps("assignee", menu.anchor)}
          title="Filter by assignee"
          items={assignable.data}
          getKey={(u) => u.login}
          getText={(u) => `${u.login} ${u.name ?? ""}`}
          renderItem={(u) => (
            <>
              <Avatar src={u.avatarUrl} login={u.login} size={20} />
              <strong>{u.login}</strong>
              {u.name && <span className="muted truncate">{u.name}</span>}
            </>
          )}
          emptyText={assignable.error ? "Failed to load assignable users" : "No matches"}
        />
      )}
      {menu?.which === "type" && (
        <SelectMenu
          {...menuProps("type", menu.anchor)}
          title="Filter by type"
          items={types.data}
          getKey={(t) => t.name}
          getText={(t) => `${t.name} ${t.description ?? ""}`}
          renderItem={(t) => (
            <span className="rf-item">
              <strong>{t.name}</strong>
              {t.description && <span className="muted truncate">{t.description}</span>}
            </span>
          )}
          emptyText={types.error ? "Failed to load issue types" : "This repository has no issue types"}
        />
      )}
      {menu?.which === "review" && (
        <SelectMenu
          {...menuProps("review", menu.anchor)}
          title="Filter by review"
          items={REVIEWS}
          getKey={(r) => r.value}
          getText={(r) => r.label}
          renderItem={(r) => r.label}
          filterable={false}
        />
      )}
      {menu?.which === "sort" && (
        <SelectMenu
          anchor={menu.anchor}
          title="Sort by"
          items={SORTS}
          getKey={(s) => s.value}
          getText={(s) => s.label}
          renderItem={(s) => s.label}
          initial={[sortValue]}
          onApply={([value]) => setQ(setSort(q, !value || value === DEFAULT_SORT ? null : value))}
          onClose={() => setMenu(null)}
          filterable={false}
        />
      )}
    </div>
  );
}
