import { LinkExternalIcon } from "@primer/octicons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { keys } from "@/api/keys";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Spinner } from "@/components/Spinner";
import { fetchAllChecks, type CheckContext, type PullMeta } from "./api";
import { CheckRow, OutcomeIcon, checkGroup, sortChecks, summarize } from "./checks";

interface Props {
  pull: PullMeta;
  owner: string;
  repo: string;
}

/** Every check run and commit status on the head commit, grouped by workflow or app. */
export function ChecksTab({ pull, owner, repo }: Props) {
  const rollup = pull.rollup;
  const more = useQuery({
    queryKey: keys.checks(owner, repo, pull.headRefOid),
    queryFn: () => fetchAllChecks(owner, repo, pull.number, pull.headRefOid),
    enabled: !!rollup?.hasNextPage,
  });
  const all: CheckContext[] = (rollup?.hasNextPage && more.data) || rollup?.contexts || [];
  const groups = useMemo(() => {
    const map = new Map<string, CheckContext[]>();
    for (const c of all) {
      const g = checkGroup(c);
      map.set(g, [...(map.get(g) ?? []), c]);
    }
    return [...map.entries()]
      .map(([name, list]) => ({ name, list: sortChecks(list), summary: summarize(list) }))
      .sort((a, b) => order(a.summary.outcome) - order(b.summary.outcome) || a.name.localeCompare(b.name));
  }, [all]);
  const ghLink = (
    <a href={`${pull.url}/checks`} target="_blank" rel="noopener noreferrer">
      View checks on GitHub <LinkExternalIcon size={12} />
    </a>
  );

  if (pull.checksForbidden)
    return (
      <div className="flash warn">
        Your token can't read checks or commit statuses for this repository. {ghLink}
      </div>
    );
  const hiddenNote = pull.checkRunsHidden && (
    <div className="flash warn checks-hidden">
      Check runs aren't visible to your token: GitHub doesn't give fine-grained tokens access to checks in private repositories.
      {all.length > 0 && " Only commit statuses are shown."} {ghLink}
    </div>
  );
  if (hiddenNote && all.length === 0) return hiddenNote;
  if (!rollup || all.length === 0)
    return (
      <div className="blankslate box">
        <p>No checks or statuses were reported on the head commit.</p>
        {ghLink}
      </div>
    );

  const overall = summarize(all, !!hiddenNote);
  return (
    <div className="checks-tab">
      {hiddenNote}
      <div className="row checks-summary">
        <OutcomeIcon outcome={overall.outcome} />
        <strong>{overall.title}</strong>
        <span className="muted grow">{overall.detail} on <code>{pull.headRefOid.slice(0, 7)}</code></span>
        {more.isFetching && <Spinner />}
        {ghLink}
      </div>
      {more.error != null && <ErrorBanner error={more.error} />}
      {groups.map((g) => (
        <section key={g.name} className="box checks-group">
          <div className="box-header row">
            <OutcomeIcon outcome={g.summary.outcome} />
            <strong className="grow">{g.name}</strong>
            <span className="muted">{g.summary.detail}</span>
          </div>
          {g.list.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </section>
      ))}
    </div>
  );
}

function order(o: string): number {
  return o === "failure" ? 0 : o === "pending" ? 1 : 2;
}
