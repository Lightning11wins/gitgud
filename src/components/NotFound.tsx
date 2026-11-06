import { useLocation } from "react-router";
import { toGitHubUrl } from "@/lib/githubUrl";
import { useTitle } from "@/lib/useTitle";

/** `title` says what's missing; without it, the page is a route GitGud doesn't have. */
export function NotFound({ title = "GitGud doesn't handle this page" }: { title?: string }) {
  const { pathname, search } = useLocation();
  useTitle("Page not found");
  return (
    <div className="blankslate">
      <h2>{title}</h2>
      <p>
        <a href={toGitHubUrl(pathname + search)} target="_blank" rel="noopener noreferrer">
          Open it on GitHub
        </a>
      </p>
    </div>
  );
}
