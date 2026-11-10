import { useState, type FormEvent } from "react";
import { useStore } from "@/lib/store";
import { auth, signIn } from "./token";
import { useTitle } from "@/lib/useTitle";

const TOKEN_URL =
  "https://github.com/settings/tokens/new?description=GitGud&scopes=repo,read:org,read:project";

export function Login() {
  useTitle("Sign in");
  const { rejected } = useStore(auth);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="box login-box" onSubmit={submit}>
        <h1>GitGud</h1>
        <p className="muted">A fast client for GitHub issues and pull requests. Paste a GitHub token to start.</p>
        {rejected && (
          <div className="flash warn">
            GitHub rejected your token for <strong>{rejected.login}</strong>. It may have expired or been revoked. Paste a
            new token to continue where you left off.
          </div>
        )}
        <label htmlFor="token" className="login-label">
          Personal access token
        </label>
        <input
          id="token"
          className="input mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="ghp_... or github_pat_..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoFocus
        />
        {error && <div className="flash error">{error}</div>}
        <button className="btn primary" disabled={!token.trim() || busy}>
          {busy ? "Checking..." : "Sign in"}
        </button>
        <div className="login-help muted">
          <p>
            <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer">
              Create a classic token
            </a>{" "}
            with <code>repo</code>, <code>read:org</code>, and <code>read:project</code> scopes, or a fine-grained token with read/write access to
            Contents, Issues, and Pull requests, plus read access to Actions, Commit statuses, and Metadata (and Members
            and Projects for organizations).
          </p>
          <p>
            The token stays in this browser (IndexedDB). It's only ever sent to api.github.com, never to the server
            hosting this page. If you already use the GitHub CLI, <code>gh auth token</code> prints a usable token.
          </p>
        </div>
      </form>
    </div>
  );
}
