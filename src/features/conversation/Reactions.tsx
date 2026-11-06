import { SmileyIcon } from "@primer/octicons-react";
import { memo, useState } from "react";
import type { ReactionContent, ReactionGroup } from "@/api/types";
import { Popover } from "@/components/Popover";

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

export interface ReactionBarProps {
  groups: ReactionGroup[];
  canReact: boolean;
  /** Called with the reaction to add (`add`) or remove; the caller updates its cache. */
  onToggle: (content: ReactionContent, add: boolean) => void;
}

/** Reaction counts plus an emoji picker, like GitHub's comment footer. */
export const ReactionBar = memo(function ReactionBar({ groups, canReact, onToggle }: ReactionBarProps) {
  const shown = REACTION_EMOJI.filter(([c]) => (groups.find((g) => g.content === c)?.reactors.totalCount ?? 0) > 0);
  if (!shown.length && !canReact) return null;
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
            title={`${content.toLowerCase().replace("_", " ")}`}
            onClick={() => onToggle(content, !g.viewerHasReacted)}
          >
            <span>{emoji}</span>
            <span>{g.reactors.totalCount}</span>
          </button>
        );
      })}
    </div>
  );
});

export function ReactionPicker({ groups, onToggle }: Omit<ReactionBarProps, "canReact">) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button className="reaction-pill add" aria-label="Add reaction" title="Add reaction" onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
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
                  title={content.toLowerCase().replace("_", " ")}
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
