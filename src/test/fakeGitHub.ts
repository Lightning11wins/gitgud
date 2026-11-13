import { vi } from "vitest";

/** Answers a GraphQL operation: return `data`, or throw to fail the request. */
type GqlHandler = (vars: Record<string, any>, query: string) => unknown | Promise<unknown>;
/** Answers a REST request: return the JSON body. */
type RestHandler = (url: URL, body: unknown) => unknown | Promise<unknown>;

export interface Call {
  op: string;
  vars: Record<string, any>;
}

/**
 * A stand-in for api.github.com behind `fetch`. GraphQL requests are routed by operation name and
 * REST requests by `METHOD /path`. Requests nobody handles stay pending (pages fire many side queries
 * a test may not care about) and are listed in `unhandled`.
 */
export function fakeGitHub() {
  const gqlHandlers = new Map<string, GqlHandler>();
  const restHandlers = new Map<string, RestHandler>();
  const calls: Call[] = [];
  const unhandled: string[] = [];

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const pending = (signal: AbortSignal | null | undefined) =>
    new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));

  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (url.pathname === "/graphql") {
      const op = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? "anonymous";
      calls.push({ op, vars: body.variables ?? {} });
      const handler = gqlHandlers.get(op);
      if (!handler) {
        unhandled.push(op);
        return pending(init.signal);
      }
      try {
        return json({ data: await handler(body.variables ?? {}, body.query) });
      } catch (e) {
        return json({ data: null, errors: [{ message: (e as Error).message }] });
      }
    }
    const route = `${method} ${url.pathname}`;
    calls.push({ op: route, vars: Object.fromEntries(url.searchParams) });
    const handler = restHandlers.get(route);
    if (!handler) {
      unhandled.push(route);
      return pending(init.signal);
    }
    return json(await handler(url, body));
  });

  return {
    fetch,
    unhandled,
    /** Handles the GraphQL operation `op`, replacing any earlier handler. */
    gql(op: string, handler: GqlHandler) {
      gqlHandlers.set(op, handler);
    },
    /** Handles REST `route`, like `GET /rate_limit`. */
    rest(route: string, handler: RestHandler) {
      restHandlers.set(route, handler);
    },
    /** Requests made so far for `op`. */
    calls: (op: string) => calls.filter((c) => c.op === op),
    /** Makes `op` wait until the returned function is called, then answer with its handler. */
    hold(op: string): () => void {
      const handler = gqlHandlers.get(op);
      if (!handler) throw new Error(`Failed to hold ${op}: no handler`);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      gqlHandlers.set(op, async (vars, query) => {
        await gate;
        return handler(vars, query);
      });
      return () => {
        gqlHandlers.set(op, handler);
        release();
      };
    },
  };
}

export type FakeGitHub = ReturnType<typeof fakeGitHub>;
