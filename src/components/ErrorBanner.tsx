import type { ReactNode } from "react";

export function ErrorBanner({ error, action }: { error: unknown; action?: ReactNode }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flash error row" role="alert">
      <span className="grow">{message}</span>
      {action}
    </div>
  );
}
