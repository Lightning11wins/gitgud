// Dependency-free, so scripts can load GraphQL operations in Node.

/** A GraphQL query or mutation, built with `gqlQuery` or `gqlMutation`. */
export interface Operation {
  readonly type: "query" | "mutation";
  readonly name: string;
  /** Variable definitions, like `$owner: String!, $repo: String!`. */
  readonly variables: string;
  /** The operation's top-level selections. */
  readonly selection: string;
}

/** A GraphQL query named `name`, selecting `selection` with `variables` defined. */
export function gqlQuery(name: string, variables: string, selection: string): Operation {
  return { type: "query", name, variables, selection };
}

/** A GraphQL mutation named `name`, selecting `selection` with `variables` defined. */
export function gqlMutation(name: string, variables: string, selection: string): Operation {
  return { type: "mutation", name, variables, selection };
}

/** The alias under which every query's response holds its rate limit cost, like `{ cost: 1 }`. */
export const COST_FIELD = "gitgudCost";

/** The GraphQL document that runs `op`. Queries also select their cost as `COST_FIELD`. */
export function gqlDocument(op: Operation): string {
  const shared = op.type === "query" ? `${COST_FIELD}: rateLimit { cost }\n` : "";
  return `${op.type} ${op.name}${op.variables ? `(${op.variables})` : ""} {\n${shared}${op.selection}\n}`;
}
