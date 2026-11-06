import { memo } from "react";
import "./title-text.css";

/** An issue or pull request title with `backtick` spans shown as code, like GitHub. */
export const TitleText = memo(function TitleText({ text }: { text: string }) {
  const parts = text.split("`");
  // An unpaired backtick stays literal.
  if (parts.length < 3) return <>{text}</>;
  const closed = parts.length % 2 === 1 ? parts : [...parts.slice(0, -2), `${parts[parts.length - 2]}\`${parts[parts.length - 1]}`];
  return (
    <>
      {closed.map((p, i) =>
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
