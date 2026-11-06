import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { gql } from "@/api/client";
import { keys } from "@/api/keys";
import { FilterInput } from "../repo/FilterInput";
import { SubjectList } from "../repo/SubjectList";
import { buildSearch, useSearchList } from "../repo/searchList";
import "./dashboard.css";

const FILTERS = [
  { name: "Review requested", q: "is:open is:pr review-requested:@me archived:false" },
  { name: "Your pull requests", q: "is:open is:pr author:@me" },
  { name: "Assigned to you", q: "is:open assignee:@me" },
  { name: "Mentioned", q: "is:open mentions:@me" },
  { name: "Your issues", q: "is:open is:issue author:@me" },
  { name: "Recently updated", q: "involves:@me sort:updated-desc" },
];
const DEFAULT_Q = "involves:@me sort:updated-desc";
const SCOPE = { defaultSort: "updated-desc" };

const COUNTS_QUERY = `
query DashboardCounts(${FILTERS.map((_, i) => `$q${i}: String!`).join(", ")}) {
  ${FILTERS.map((_, i) => `c${i}: search(type: ISSUE_ADVANCED, query: $q${i}, first: 0) { issueCount }`).join("\n  ")}
}`;

async function fetchCounts(): Promise<number[]> {
  const vars = Object.fromEntries(FILTERS.map((f, i) => [`q${i}`, buildSearch(f.q, SCOPE)]));
  const data = await gql<Record<string, { issueCount: number }>>(COUNTS_QUERY, vars);
  return FILTERS.map((_, i) => data[`c${i}`].issueCount);
}

export function Dashboard() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? DEFAULT_Q;
  const setQ = (next: string) => setParams(next === DEFAULT_Q ? {} : { q: next }, { replace: true });

  const counts = useQuery({ queryKey: keys.dashboard("counts"), queryFn: fetchCounts });
  const search = buildSearch(q, SCOPE);
  const list = useSearchList(keys.dashboard(`list:${search}`), search);

  return (
    <div className="dash">
      <nav className="dash-filters" aria-label="Filters">
        {FILTERS.map((f, i) => (
          <button key={f.name} className="dash-filter" data-selected={f.q === q} onClick={() => setQ(f.q)} title={f.q}>
            <span className="grow truncate">{f.name}</span>
            {counts.data && <span className="counter">{counts.data[i]}</span>}
          </button>
        ))}
      </nav>
      <section className="dash-main">
        <FilterInput value={q} onApply={(next) => setQ(next || DEFAULT_Q)} placeholder="Search issues and pull requests" />
        <SubjectList
          data={list.data}
          isPending={list.isPending}
          isFetching={list.isFetching}
          error={list.error}
          moreError={list.moreError}
          loadingMore={list.loadingMore}
          onRetry={() => void list.refetch()}
          loadMore={() => void list.loadMore()}
          showRepo
          empty="Nothing matches this search."
          header={
            <span className="muted">
              {list.data ? `${list.data.total.toLocaleString()} results` : " "}
            </span>
          }
        />
      </section>
    </div>
  );
}
