import { gqlPartial } from "./client";

export const BODY_HTML_QUERY = `query BodyHtml($ids: [ID!]!) { nodes(ids: $ids) { ... on Comment { id bodyHTML } } }`;

/** GitHub signs attachment links for 5 minutes; reuse a fetch for less than that. */
const REUSE_MS = 4 * 60_000;
const BATCH = 100;

const loads = new Map<string, Promise<string | undefined>>();
let queued: { id: string; resolve: (html: string | undefined) => void }[] = [];

async function flush() {
  const batch = queued;
  queued = [];
  for (let i = 0; i < batch.length; i += BATCH) {
    const part = batch.slice(i, i + BATCH);
    try {
      const { data } = await gqlPartial<{ nodes: ({ id?: string; bodyHTML?: string } | null)[] }>(BODY_HTML_QUERY, { ids: part.map((p) => p.id) });
      const html = new Map(data.nodes.map((n) => [n?.id, n?.bodyHTML]));
      for (const p of part) p.resolve(html.get(p.id));
    } catch (e) {
      console.error(e);
      for (const p of part) p.resolve(undefined);
    }
  }
}

/** Fresh `bodyHTML` for a comment, issue, or PR, so its signed attachment links work again. Batches calls made together. */
export function freshBodyHtml(id: string): Promise<string | undefined> {
  let load = loads.get(id);
  if (!load) {
    load = new Promise((resolve) => {
      if (!queued.length) setTimeout(flush, 50);
      queued.push({ id, resolve });
    });
    loads.set(id, load);
    setTimeout(() => loads.delete(id), REUSE_MS);
  }
  return load;
}
