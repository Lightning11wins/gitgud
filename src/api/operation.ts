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

/** The GraphQL document that runs `op`. */
export function gqlDocument(op: Operation): string {
  return `${op.type} ${op.name}${op.variables ? `(${op.variables})` : ""} {\n${op.selection}\n}`;
}
