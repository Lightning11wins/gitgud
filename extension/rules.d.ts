export const GITHUB_PAGE: string;
export const RESERVED_OWNERS: string[];
export const REDIRECT_RULE_ID: number;
export const RESERVED_RULE_ID: number;

export interface Rule {
  id: number;
  priority: number;
  action: { type: "redirect"; redirect: { regexSubstitution: string } } | { type: "allow" };
  condition: { resourceTypes: string[]; excludedInitiatorDomains: string[]; regexFilter: string };
}

export function buildRules(origin: string): Rule[];
export function originFromRules(rules: Rule[]): string | null;
export function parseOrigin(input: string): string | null;
