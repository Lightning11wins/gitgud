import { AlertIcon, CheckCircleFillIcon, DotFillIcon, SkipIcon, SquareFillIcon, StopIcon, XCircleFillIcon } from "@primer/octicons-react";
import { memo, type ReactNode } from "react";
import { useSecond } from "@/lib/time";
import type { CheckContext, RollupState } from "./api";
import { formatDuration } from "./util";

export type CheckOutcome = "success" | "failure" | "pending" | "skipped" | "neutral" | "cancelled" | "action";

export function checkOutcome(c: CheckContext): CheckOutcome {
  if (c.__typename === "StatusContext") {
    if (c.state === "SUCCESS") return "success";
    if (c.state === "FAILURE" || c.state === "ERROR") return "failure";
    return "pending";
  }
  if (c.status !== "COMPLETED") return "pending";
  switch (c.conclusion) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
      return "failure";
    case "SKIPPED":
      return "skipped";
    case "CANCELLED":
      return "cancelled";
    case "ACTION_REQUIRED":
      return "action";
    default:
      return "neutral";
  }
}

const OUTCOME_ORDER: Record<CheckOutcome, number> = { failure: 0, action: 1, cancelled: 2, pending: 3, neutral: 4, success: 5, skipped: 6 };

export function sortChecks(list: CheckContext[]): CheckContext[] {
  return [...list].sort((a, b) => OUTCOME_ORDER[checkOutcome(a)] - OUTCOME_ORDER[checkOutcome(b)] || checkName(a).localeCompare(checkName(b)));
}

export function OutcomeIcon({ outcome, size = 16 }: { outcome: CheckOutcome; size?: number }) {
  switch (outcome) {
    case "success":
      return <CheckCircleFillIcon size={size} className="check-icon success" aria-label="Successful" />;
    case "failure":
      return <XCircleFillIcon size={size} className="check-icon failure" aria-label="Failing" />;
    case "pending":
      return <DotFillIcon size={size} className="check-icon pending" aria-label="Pending" />;
    case "skipped":
      return <SkipIcon size={size} className="check-icon muted" aria-label="Skipped" />;
    case "cancelled":
      return <StopIcon size={size} className="check-icon muted" aria-label="Cancelled" />;
    case "action":
      return <AlertIcon size={size} className="check-icon pending" aria-label="Action required" />;
    default:
      return <SquareFillIcon size={size} className="check-icon muted" aria-label="Neutral" />;
  }
}

export function rollupOutcome(state: RollupState | undefined | null): CheckOutcome | null {
  if (!state) return null;
  if (state === "SUCCESS") return "success";
  if (state === "FAILURE" || state === "ERROR") return "failure";
  return "pending";
}

export function checkName(c: CheckContext): string {
  return c.__typename === "CheckRun" ? c.name : c.context;
}

/** Workflow or app name used to group check runs. */
export function checkGroup(c: CheckContext): string {
  if (c.__typename === "StatusContext") return "Commit statuses";
  return c.checkSuite?.workflowRun?.workflow.name ?? c.checkSuite?.app?.name ?? "Other checks";
}

export function checkLink(c: CheckContext): string | null {
  return c.__typename === "CheckRun" ? (c.detailsUrl ?? c.url) : c.targetUrl;
}

/** Time since `since`, counting up each second. */
function Elapsed({ since }: { since: string }) {
  return formatDuration(useSecond() * 1000 - Date.parse(since));
}

function checkDetail(c: CheckContext, outcome: CheckOutcome): ReactNode {
  if (c.__typename === "StatusContext") return c.description ?? "";
  if (c.status === "QUEUED" || c.status === "WAITING" || c.status === "PENDING" || c.status === "REQUESTED") return "Queued";
  if (!c.startedAt) return outcome === "skipped" ? "Skipped" : "";
  if (c.status !== "COMPLETED")
    return (
      <>
        Started <Elapsed since={c.startedAt} /> ago
      </>
    );
  const verb = { success: "Successful", failure: "Failing", skipped: "Skipped", cancelled: "Cancelled", action: "Action required", neutral: "Completed", pending: "" }[outcome];
  return c.completedAt ? `${verb} in ${formatDuration(Date.parse(c.completedAt) - Date.parse(c.startedAt))}` : verb;
}

/** Counts and a headline for `list`; `statusesOnly` words it for commit statuses when check runs are hidden. */
export function summarize(list: CheckContext[], statusesOnly = false) {
  const counts: Record<CheckOutcome, number> = { success: 0, failure: 0, pending: 0, skipped: 0, neutral: 0, cancelled: 0, action: 0 };
  for (const c of list) counts[checkOutcome(c)]++;
  const failing = counts.failure + counts.action + counts.cancelled;
  const parts = [
    failing && `${failing} failing`,
    counts.pending && `${counts.pending} in progress`,
    counts.skipped && `${counts.skipped} skipped`,
    counts.neutral && `${counts.neutral} neutral`,
    counts.success && `${counts.success} successful`,
  ].filter(Boolean);
  const outcome: CheckOutcome = failing ? "failure" : counts.pending ? "pending" : "success";
  const noun = statusesOnly ? "commit statuses" : "checks";
  const title =
    outcome === "failure" ? `Some ${noun} were not successful` : outcome === "pending" ? `Some ${noun} haven't completed yet` : `All ${noun} have passed`;
  const unit = statusesOnly ? (list.length === 1 ? "status" : "statuses") : list.length === 1 ? "check" : "checks";
  return { counts, outcome, title, detail: `${parts.join(", ")} ${unit}` };
}

/** One check run or commit status with its status icon, duration, and a link to GitHub. */
export const CheckRow = memo(function CheckRow({ check, showGroup }: { check: CheckContext; showGroup?: boolean }) {
  const outcome = checkOutcome(check);
  const link = checkLink(check);
  const logo = check.__typename === "CheckRun" ? check.checkSuite?.app?.logoUrl : check.avatarUrl;
  const event = check.__typename === "CheckRun" ? check.checkSuite?.workflowRun?.event : undefined;
  const detail = checkDetail(check, outcome);
  return (
    <div className="check-row">
      <OutcomeIcon outcome={outcome} />
      {logo ? <img className="check-logo" src={logo} width={16} height={16} alt="" loading="lazy" /> : <span className="check-logo" />}
      <span className="grow truncate">
        {showGroup && check.__typename === "CheckRun" && <span className="muted">{checkGroup(check)} / </span>}
        <strong>{checkName(check)}</strong>
        {event && <span className="muted"> ({event})</span>}
        {detail && <span className="muted"> {detail}</span>}
      </span>
      {check.isRequired && <span className="label check-required">Required</span>}
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="check-details">
          Details
        </a>
      )}
    </div>
  );
});
