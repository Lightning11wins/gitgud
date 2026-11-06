import { auth, tokenRejected, type AuthState } from "@/auth/token";
import { recordRateLimit, recordRequest } from "./rateLimit";

export const API_BASE = "https://api.github.com";

export class GitHubError extends Error {
  status: number;
  errors?: unknown[];
  constructor(message: string, status: number, errors?: unknown[]) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.errors = errors;
  }
}

export class AuthError extends GitHubError {}

/** True for a REST 404 or a GraphQL failure whose errors are all NOT_FOUND. */
export function isNotFound(e: unknown): boolean {
  if (!(e instanceof GitHubError)) return false;
  if (e.status === 404) return true;
  return !!e.errors?.length && e.errors.every((err) => (err as GqlError).type === "NOT_FOUND");
}

function authHeaders(session: AuthState): Record<string, string> {
  if (!session.token) throw new AuthError("Failed to call the GitHub API: no token is set", 401);
  return { Authorization: `Bearer ${session.token}`, "X-GitHub-Api-Version": "2022-11-28" };
}

async function failure(res: Response, what: string, session: AuthState): Promise<GitHubError> {
  if (res.status === 401) tokenRejected(session);
  let message = `${res.status} ${res.statusText}`;
  let errors: unknown[] | undefined;
  try {
    const body = await res.json();
    if (body?.message) message = body.message;
    if (Array.isArray(body?.errors)) {
      errors = body.errors;
      const details = body.errors
        .map((e: { message?: string; code?: string; field?: string }) => e.message ?? [e.field, e.code].filter(Boolean).join(" "))
        .filter(Boolean);
      if (details.length) message += `: ${details.join("; ")}`;
    }
  } catch {
    // Non-JSON error body.
  }
  const Ctor = res.status === 401 ? AuthError : GitHubError;
  return new Ctor(`Failed to ${what}: ${message}`, res.status, errors);
}

export interface GqlOptions {
  signal?: AbortSignal;
  /** Extra preview/feature headers, e.g. `GraphQL-Features: sub_issues`. */
  headers?: Record<string, string>;
}

export interface GqlError {
  message: string;
  type?: string;
  path?: (string | number)[];
}

function operationName(query: string): string {
  return /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "anonymous";
}

function gqlFailure(query: string, errors: GqlError[]): GitHubError {
  return new GitHubError(`Failed to run GraphQL ${operationName(query)}: ${errors.map((e) => e.message).join("; ")}`, 200, errors);
}

/** Runs a GraphQL query or mutation and returns `data`, throwing on any error. */
export async function gql<T>(query: string, variables: Record<string, unknown> = {}, opts: GqlOptions = {}): Promise<T> {
  const { data, errors } = await gqlPartial<T>(query, variables, opts);
  if (errors.length) throw gqlFailure(query, errors);
  return data;
}

/** Like `gql`, but returns partial `data` with its field errors. Throws only when there is no data. */
export async function gqlPartial<T>(query: string, variables: Record<string, unknown> = {}, opts: GqlOptions = {}): Promise<{ data: T; errors: GqlError[] }> {
  const opName = operationName(query);
  opts.signal?.throwIfAborted();
  const session = auth.get();
  recordRequest("graphql", opName);
  const res = await fetch(`${API_BASE}/graphql`, {
    method: "POST",
    headers: { ...authHeaders(session), "Content-Type": "application/json", ...opts.headers },
    body: JSON.stringify({ query, variables }),
    signal: opts.signal,
  });
  recordRateLimit(res.headers);
  if (!res.ok) throw await failure(res, `run GraphQL ${opName}`, session);
  const body = (await res.json()) as { data?: T | null; errors?: GqlError[] };
  const errors = body.errors ?? [];
  if (body.data == null && errors.length) throw gqlFailure(query, errors);
  return { data: body.data as T, errors };
}

export interface RestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Defaults to `application/vnd.github+json`. Use `application/vnd.github.full+json` to get `body_html`. */
  accept?: string;
  signal?: AbortSignal;
  /** Return the raw Response text (e.g. diffs, raw file contents). */
  text?: boolean;
}

export interface RestResponse<T> {
  data: T;
  headers: Headers;
  status: number;
}

/** Calls a REST endpoint. `path` is relative to api.github.com (e.g. `/repos/o/r/pulls/1`) or absolute. */
export async function restRaw<T>(path: string, opts: RestOptions = {}): Promise<RestResponse<T>> {
  const method = opts.method ?? "GET";
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  // The token goes only to api.github.com.
  if (!url.startsWith(`${API_BASE}/`)) throw new GitHubError(`Failed to ${method} ${path}: not an api.github.com URL`, 0);
  opts.signal?.throwIfAborted();
  const session = auth.get();
  recordRequest("rest", `${method} ${path.replace(/\?.*/, "")}`);
  const headers: Record<string, string> = { ...authHeaders(session), Accept: opts.accept ?? "application/vnd.github+json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
    // Always revalidate with the server; 304 responses are free against the rate limit.
    cache: method === "GET" ? "no-cache" : "no-store",
  });
  recordRateLimit(res.headers);
  if (!res.ok) throw await failure(res, `${method} ${path}`, session);
  let data: unknown;
  if (opts.text) data = await res.text();
  else if (res.status === 204) data = undefined;
  else {
    const raw = await res.text();
    data = raw ? JSON.parse(raw) : undefined;
  }
  return { data: data as T, headers: res.headers, status: res.status };
}

export async function rest<T>(path: string, opts: RestOptions = {}): Promise<T> {
  return (await restRaw<T>(path, opts)).data;
}

function lastPage(link: string | null): number {
  const m = link && /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return m ? Number(m[1]) : 1;
}

/**
 * Fetches every page of a paginated REST list. Reads the last page number from the
 * first response's Link header, then fetches the remaining pages in parallel.
 */
export async function restAll<T>(path: string, opts: Omit<RestOptions, "method" | "body"> & { maxPages?: number } = {}): Promise<T[]> {
  const sep = path.includes("?") ? "&" : "?";
  const pageUrl = (p: number) => `${path}${sep}per_page=100&page=${p}`;
  const first = await restRaw<T[] | { items?: T[] }>(pageUrl(1), opts);
  const items = (d: T[] | { items?: T[] }) => (Array.isArray(d) ? d : (d.items ?? []));
  const last = Math.min(lastPage(first.headers.get("link")), opts.maxPages ?? 100);
  const rest = await mapLimit(
    Array.from({ length: last - 1 }, (_, i) => i + 2),
    6,
    (p) => restRaw<T[] | { items?: T[] }>(pageUrl(p), opts).then((r) => items(r.data)),
  );
  return [...items(first.data), ...rest.flat()];
}

/** Like Promise.all over `inputs.map(fn)` but with at most `limit` in flight. Preserves order. */
export async function mapLimit<I, O>(inputs: I[], limit: number, fn: (input: I, index: number) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(inputs.length);
  let next = 0;
  const worker = async () => {
    while (next < inputs.length) {
      const i = next++;
      out[i] = await fn(inputs[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, worker));
  return out;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

/**
 * Follows a GraphQL connection to the end. `fetchPage` receives the cursor (null first)
 * and returns that page's nodes and pageInfo. `onPage` is called with all nodes so far,
 * which lets callers render progressively.
 */
export async function gqlAll<N>(
  fetchPage: (after: string | null) => Promise<{ nodes: N[]; pageInfo: PageInfo }>,
  onPage?: (nodesSoFar: N[]) => void,
): Promise<N[]> {
  const all: N[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await fetchPage(after);
    all.push(...page.nodes);
    onPage?.(all);
    if (!page.pageInfo.hasNextPage) return all;
    after = page.pageInfo.endCursor;
  }
}
