import type { ReactNode } from "react";
import type { SubjectMeta } from "@/api/types";

export interface MetadataSidebarProps {
  subject: SubjectMeta;
  owner: string;
  repo: string;
  /** Extra sections rendered first, e.g. reviewers for PRs. */
  children?: ReactNode;
}

export function MetadataSidebar({ children }: MetadataSidebarProps) {
  return <aside>{children}</aside>;
}
