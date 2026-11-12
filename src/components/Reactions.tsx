import { SmileyIcon } from "@primer/octicons-react";
import { memo, useState } from "react";
import type { ReactionContent, ReactionGroup } from "@/api/types";
import { auth } from "@/auth/token";
import { useStore } from "@/lib/store";
import { Popover } from "./Popover";
import "./reactions.css";
import { tooltip } from "@/lib/tooltip";

export const REACTION_EMOJI: [ReactionContent, string][] = [
  ["THUMBS_UP", "👍"],
  ["THUMBS_DOWN", "👎"],
  ["LAUGH", "😄"],
  ["HOORAY", "🎉"],
  ["CONFUSED", "😕"],
  ["HEART", "❤️"],
  ["ROCKET", "🚀"],
  ["EYES", "👀"],
];

const reactionName = (content: ReactionContent) => content.toLowerCase().replace("_", " ");

/** Who reacted, like GitHub's tooltip: "You, alice, and 3 more reacted with eyes emoji". */
export function reactorsLabel(group: ReactionGroup, viewerLogin: string | undefined): string {
  const others = group.reactors.nodes.map((n) => n.login).filter((l) => l !== viewerLogin);
  const names = group.viewerHasReacted ? ["You", ...others] : others;
  const more = group.reactors.totalCount - names.length;
  const list = new Intl.ListFormat("en", { type: "conjunction" }).format(more > 0 ? [...names, `${more} more`] : names);
  return `${list} reacted with ${reactionName(group.content)} emoji`;
}

export interface ReactionBarProps {
  groups: ReactionGroup[];
  canReact: boolean;
  /** Called with the reaction to add (`add`) or remove; the caller updates its cache. */
  onToggle: (content: ReactionContent, add: boolean) => void;
  error?: string | null;
}

/** Reaction counts plus an emoji picker, like GitHub's comment footer. */
export const ReactionBar = memo(function ReactionBar({ groups, canReact, onToggle, error }: ReactionBarProps) {
  const viewerLogin = useStore(auth).viewer?.login;
  const shown = REACTION_EMOJI.filter(([c]) => (groups.find((g) => g.content === c)?.reactors.totalCount ?? 0) > 0);
  if (!shown.length && !canReact && !error) return null;
  return (
    <div className="reaction-bar">
      {canReact && <ReactionPicker groups={groups} onToggle={onToggle} />}
      {shown.map(([content, emoji]) => {
        const g = groups.find((x) => x.content === content)!;
        return (
          <button
            key={content}
            className={`reaction-pill ${g.viewerHasReacted ? "reacted" : ""}`}
            disabled={!canReact}
            aria-pressed={g.viewerHasReacted}
            {...tooltip(reactorsLabel(g, viewerLogin))}
            onClick={() => onToggle(content, !g.viewerHasReacted)}
          >
            <span>{emoji}</span>
            <span>{g.reactors.totalCount}</span>
          </button>
        );
      })}
      {error && <span className="reaction-error">{error}</span>}
    </div>
  );
});

export function ReactionPicker({ groups, onToggle }: Pick<ReactionBarProps, "groups" | "onToggle">) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button className="reaction-pill add" {...tooltip("Add reaction", "label")} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <SmileyIcon size={16} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={232}>
          <div className="reaction-picker">
            {REACTION_EMOJI.map(([content, emoji]) => {
              const reacted = groups.find((g) => g.content === content)?.viewerHasReacted ?? false;
              return (
                <button
                  key={content}
                  className={`btn invisible sm icon ${reacted ? "reacted" : ""}`}
                  aria-pressed={reacted}
                  {...tooltip(reactionName(content), "label")}
                  onClick={() => {
                    onToggle(content, !reacted);
                    setAnchor(null);
                  }}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </>
  );
}
