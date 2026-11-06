import { isBot } from "@/api/types";

/** The "bot" pill GitHub shows after a bot account's name. */
export function BotBadge({ actor }: { actor: { __typename?: string } | null | undefined }) {
  return isBot(actor) ? <span className="label bot-badge">bot</span> : null;
}
