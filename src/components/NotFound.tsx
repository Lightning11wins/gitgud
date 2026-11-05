import { useLocation } from "react-router";
import { toGitHubUrl } from "@/lib/githubUrl";

export function NotFound() {
  const { pathname, search } = useLocation();
  return (
    <div className="blankslate">
      <h2>gitgud doesn't handle this page</h2>
      <p>
        <a href={toGitHubUrl(pathname + search)} target="_blank" rel="noopener noreferrer">
          Open it on GitHub
        </a>
      </p>
    </div>
  );
}
