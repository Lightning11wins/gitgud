import { useRef, useState } from "react";
import { gql } from "@/api/client";
import type { ReactionContent, ReactionGroup } from "@/api/types";

const GROUP_FIELDS = `reactionGroups { content viewerHasReacted reactors { totalCount } }`;
const ADD = `mutation AddReaction($id: ID!, $content: ReactionContent!) { addReaction(input: { subjectId: $id, content: $content }) { ${GROUP_FIELDS} } }`;
const REMOVE = `mutation RemoveReaction($id: ID!, $content: ReactionContent!) { removeReaction(input: { subjectId: $id, content: $content }) { ${GROUP_FIELDS} } }`;

type AddData = { addReaction: { reactionGroups: ReactionGroup[] } };
type RemoveData = { removeReaction: { reactionGroups: ReactionGroup[] } };

function toggled(groups: ReactionGroup[], content: ReactionContent): ReactionGroup[] {
  const has = groups.some((g) => g.content === content);
  const list = has ? groups : [...groups, { content, viewerHasReacted: false, reactors: { totalCount: 0 } }];
  return list.map((g) =>
    g.content !== content
      ? g
      : { ...g, viewerHasReacted: !g.viewerHasReacted, reactors: { totalCount: g.reactors.totalCount + (g.viewerHasReacted ? -1 : 1) } },
  );
}

/** Reaction groups with optimistic toggling. `onChange` receives the server's groups, to update the cache. */
export function useReactions(subjectId: string, groups: ReactionGroup[], onChange?: (groups: ReactionGroup[]) => void) {
  // Local groups win until the parent passes new ones.
  const [local, setLocal] = useState<{ base: ReactionGroup[]; groups: ReactionGroup[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Toggles run one at a time so a quick add then remove reaches GitHub in order.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  const shown = local && local.base === groups ? local.groups : groups;

  const toggle = (content: ReactionContent) => {
    const before = shown;
    const reacted = before.find((g) => g.content === content)?.viewerHasReacted ?? false;
    setLocal({ base: groups, groups: toggled(before, content) });
    setError(null);
    inFlight.current++;
    queue.current = queue.current.then(async () => {
      try {
        const next = reacted
          ? (await gql<RemoveData>(REMOVE, { id: subjectId, content })).removeReaction.reactionGroups
          : (await gql<AddData>(ADD, { id: subjectId, content })).addReaction.reactionGroups;
        // Server groups are applied once the last queued toggle lands.
        if (inFlight.current === 1) onChange?.(next);
      } catch (e) {
        setLocal(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current--;
      }
    });
  };
  return { groups: shown, toggle, error };
}
