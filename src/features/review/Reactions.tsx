import { SmileyIcon } from "@primer/octicons-react";
import { useRef, useState } from "react";
import { gql } from "@/api/client";
import type { ReactionContent, ReactionGroup } from "@/api/types";
import { Popover } from "@/components/Popover";

export const REACTION_EMOJI: Record<ReactionContent, string> = {
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
  LAUGH: "😄",
  HOORAY: "🎉",
  CONFUSED: "😕",
  HEART: "❤️",
  ROCKET: "🚀",
  EYES: "👀",
};

const ORDER = Object.keys(REACTION_EMOJI) as ReactionContent[];
const LABEL: Record<ReactionContent, string> = {
  THUMBS_UP: "+1",
  THUMBS_DOWN: "-1",
  LAUGH: "laugh",
  HOORAY: "hooray",
  CONFUSED: "confused",
  HEART: "heart",
  ROCKET: "rocket",
  EYES: "eyes",
};

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

/** Smiley button opening the emoji picker. */
export function ReactionPickerButton({ groups, onToggle }: { groups: ReactionGroup[]; onToggle: (c: ReactionContent) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        className="btn invisible xs icon reaction-add"
        aria-label="Add reaction"
        title="Add reaction"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <SmileyIcon size={14} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)}>
          <div className="reaction-picker">
            {ORDER.map((c) => (
              <button
                key={c}
                className={`btn invisible sm icon${groups.find((g) => g.content === c)?.viewerHasReacted ? " active" : ""}`}
                title={LABEL[c]}
                aria-label={LABEL[c]}
                onClick={() => {
                  setAnchor(null);
                  onToggle(c);
                }}
              >
                {REACTION_EMOJI[c]}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

/** Pills for reactions with a nonzero count. Renders nothing when there are none. */
export function ReactionPills({
  groups,
  canReact,
  onToggle,
  error,
}: {
  groups: ReactionGroup[];
  canReact: boolean;
  onToggle: (c: ReactionContent) => void;
  error?: string | null;
}) {
  const active = ORDER.map((c) => groups.find((g) => g.content === c)).filter((g): g is ReactionGroup => !!g && g.reactors.totalCount > 0);
  if (!active.length && !error) return null;
  return (
    <div className="reactions">
      {active.map((g) => (
        <button
          key={g.content}
          className={`reaction${g.viewerHasReacted ? " active" : ""}`}
          disabled={!canReact}
          title={LABEL[g.content]}
          aria-pressed={g.viewerHasReacted}
          onClick={() => onToggle(g.content)}
        >
          <span>{REACTION_EMOJI[g.content]}</span>
          <span>{g.reactors.totalCount}</span>
        </button>
      ))}
      {canReact && active.length > 0 && <ReactionPickerButton groups={groups} onToggle={onToggle} />}
      {error && <span className="reaction-error">{error}</span>}
    </div>
  );
}
