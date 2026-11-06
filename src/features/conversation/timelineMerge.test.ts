import { describe, expect, it } from "vitest";
import { countsMatch, countsTrusted, createMerger, FULL_RELOAD_MS, RECHECK_MS, recheckDue, reloadDue, resumed, type ResumeResult } from "./timelineMerge";
import type { TimelineData, TimelineItem } from "./types";

const comment = (id: string, body = id) => ({ __typename: "IssueComment", id, body }) as unknown as TimelineItem;
const commit = (id: string) => ({ __typename: "PullRequestCommit", id }) as TimelineItem;
const event = (id: string, __typename = "LabeledEvent") => ({ __typename, id }) as TimelineItem;

const cached: TimelineData = { stamp: "s1", items: [commit("c1"), comment("a"), comment("b")], endCursor: "cur-b", fullAt: 1000 };

/** What a resume from `cached` returns when GitHub now has `server` items and appends `appended`. */
function resume(server: TimelineItem[], appended: TimelineItem[], base = cached): ResumeResult {
  const m = createMerger(base.items);
  m.add(appended);
  const movable = server.filter((it) => it.__typename === "PullRequestCommit").length;
  return {
    items: m.items,
    added: m.added,
    endCursor: appended.length ? `cur-${appended[appended.length - 1].id}` : base.endCursor,
    complete: true,
    counts: { total: server.length, movable },
  };
}

describe("createMerger", () => {
  it("updates known ids in place and appends new ones", () => {
    const m = createMerger([comment("a"), comment("b")]);
    m.add([comment("b", "edited"), comment("c")]);
    expect(m.items.map((it) => it.id)).toEqual(["a", "b", "c"]);
    expect((m.items[1] as unknown as { body: string }).body).toBe("edited");
    expect(m.added.map((it) => it.id)).toEqual(["c"]);
  });
});

describe("countsMatch", () => {
  it("compares the total and the movable count", () => {
    const items = [commit("c1"), comment("a")];
    expect(countsMatch(items, { total: 2, movable: 1 })).toBe(true);
    expect(countsMatch(items, { total: 2, movable: 2 })).toBe(false);
    expect(countsMatch(items, { total: 3, movable: 1 })).toBe(false);
  });
});

describe("countsTrusted", () => {
  it("distrusts pages when the total disagrees with the first page's count", () => {
    // cli/cli#9000 with a fine-grained token: 26 items, a total of 17, and a first page of 25 with no next page.
    expect(countsTrusted({ total: 17, movable: 3 }, 25)).toBe(false);
    expect(countsTrusted({ total: 26, movable: 12 }, 26)).toBe(true);
    expect(countsTrusted(undefined, 26)).toBe(true);
  });
});

describe("resumed", () => {
  it("takes the new stamp when items were appended", () => {
    const next = resumed(cached, resume([...cached.items, comment("c")], [comment("c")]), "s2");
    expect(next).toMatchObject({ stamp: "s2", endCursor: "cur-c", fullAt: 1000, edited: false });
    expect(next?.items.map((it) => it.id)).toEqual(["c1", "a", "b", "c"]);
  });

  it("takes the new stamp but marks the timeline edited when nothing was appended", () => {
    const next = resumed(cached, resume(cached.items, []), "s2");
    expect(next).toMatchObject({ stamp: "s2", edited: true });
  });

  it("keeps the edited mark across later appends", () => {
    const edited = { ...cached, edited: true };
    const next = resumed(edited, resume([...cached.items, comment("c")], [comment("c")], edited), "s3");
    expect(next?.edited).toBe(true);
  });

  it("doesn't mark a recheck with an unchanged stamp edited", () => {
    expect(resumed(cached, resume(cached.items, []), "s1")).toMatchObject({ stamp: "s1", edited: false });
  });

  it("appends a cross-reference found by a recheck with an unchanged stamp", () => {
    // Mentions from other issues don't change the subject's updatedAt.
    const ref = event("x", "CrossReferencedEvent");
    const next = resumed(cached, resume([...cached.items, ref], [ref]), "s1");
    expect(next).toMatchObject({ stamp: "s1", endCursor: "cur-x", edited: false });
    expect(next?.items.map((it) => it.id)).toEqual(["c1", "a", "b", "x"]);
  });

  it("doesn't mark an incomplete cache edited", () => {
    const partial = { ...cached, stamp: "" };
    expect(resumed(partial, resume(cached.items, [], partial), "s2")?.edited).toBe(false);
  });

  it("reloads after a deletion", () => {
    expect(resumed(cached, resume([commit("c1"), comment("a")], []), "s2")).toBeNull();
  });

  it("reloads after one deletion and one append", () => {
    expect(resumed(cached, resume([commit("c1"), comment("a"), comment("c")], [comment("c")]), "s2")).toBeNull();
  });

  it("reloads when a deleted comment is offset by a commit inserted before the cursor", () => {
    // The pushed commit sorts by its commit date, before the cached end cursor, so the resume misses it.
    const server = [commit("c1"), commit("c0"), comment("a")];
    const r = resume(server, []);
    expect(r.items.length).toBe(server.length);
    expect(resumed(cached, r, "s2")).toBeNull();
  });

  it("reloads after a force push, even when the counts match", () => {
    // c1 was replaced by c2, which sorts before the cursor; only the force-push event is appended.
    const server = [commit("c2"), comment("a"), comment("b"), event("fp", "HeadRefForcePushedEvent")];
    expect(resumed(cached, resume(server, [event("fp", "HeadRefForcePushedEvent")]), "s2")).toBeNull();
  });

  it("returns an incomplete timeline without a stamp", () => {
    const r = { ...resume([...cached.items, comment("c")], [comment("c")]), complete: false };
    expect(resumed(cached, r, "s2")).toMatchObject({ stamp: "", endCursor: "cur-c" });
  });
});

describe("reloadDue", () => {
  it("reloads an edited timeline once fullAt is old", () => {
    const edited = { ...cached, edited: true };
    expect(reloadDue(edited, cached.fullAt + FULL_RELOAD_MS - 1)).toBe(false);
    expect(reloadDue(edited, cached.fullAt + FULL_RELOAD_MS)).toBe(true);
    expect(reloadDue(cached, cached.fullAt + FULL_RELOAD_MS)).toBe(false);
    expect(reloadDue(undefined, 0)).toBe(false);
  });
});

describe("recheckDue", () => {
  it("rechecks a complete timeline once the last check is old", () => {
    expect(recheckDue(cached, cached.fullAt + RECHECK_MS - 1)).toBe(false);
    expect(recheckDue(cached, cached.fullAt + RECHECK_MS)).toBe(true);
    const checked = { ...cached, checkedAt: cached.fullAt + RECHECK_MS };
    expect(recheckDue(checked, cached.fullAt + RECHECK_MS)).toBe(false);
    expect(recheckDue({ ...cached, stamp: "" }, cached.fullAt + RECHECK_MS)).toBe(false);
    expect(recheckDue(undefined, 0)).toBe(false);
  });
});
