import { useLocation } from "react-router";
import { toGitHubUrl } from "@/lib/githubUrl";
import { useTitle } from "@/lib/useTitle";

export function NotFound() {
  const { pathname, search } = useLocation();
  useTitle("Page not found");
  return (
    <div className="blankslate">
      <h2>GitGud doesn't handle this page</h2>
      <p>
        <a href={toGitHubUrl(pathname + search)} target="_blank" rel="noopener noreferrer">
          Open it on GitHub
        </a>
      </p>
    </div>
  );
}
