import { useStore } from "@/lib/store";
import { formatRelative, minuteTick } from "@/lib/time";

export function RelativeTime({ date, prefix }: { date: string; prefix?: string }) {
  useStore(minuteTick);
  const d = new Date(date);
  return (
    <time dateTime={date} title={d.toLocaleString()}>
      {prefix ? `${prefix} ` : ""}
      {formatRelative(d)}
    </time>
  );
}
