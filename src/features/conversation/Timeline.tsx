import type { SubjectMeta } from "@/api/types";

export interface TimelineProps {
  owner: string;
  repo: string;
  number: number;
  kind: "issue" | "pull";
  /** Header data; the body renders as the first comment. */
  subject: SubjectMeta;
}

export function Timeline(_props: TimelineProps) {
  return <div className="blankslate">Timeline is not built yet.</div>;
}
