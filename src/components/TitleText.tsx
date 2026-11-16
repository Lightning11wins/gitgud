import { memo } from "react";
import "./title-text.css";

/** An issue or PR title split at its `backtick` spans: odd indexes are code. An unpaired backtick stays literal. */
export function titleParts(text: string): string[] {
  const parts = text.split("`");
  if (parts.length < 3) return [text];
  return parts.length % 2 === 1 ? parts : [...parts.slice(0, -2), `${parts[parts.length - 2]}\`${parts[parts.length - 1]}`];
}

/** An issue or pull request title with `backtick` spans shown as code, like GitHub. */
export const TitleText = memo(function TitleText({ text }: { text: string }) {
  const parts = titleParts(text);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <code key={i} className="title-code">
            {p}
          </code>
        ) : (
          p
        ),
      )}
    </>
  );
});
