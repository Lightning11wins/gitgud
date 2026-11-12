import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { gql, gqlAll, tokenScopes, type PageInfo } from "@/api/client";
import { keys } from "@/api/keys";
import { Avatar } from "@/components/Avatar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Spinner } from "@/components/Spinner";
import { useTitle } from "@/lib/useTitle";
import "./owner.css";

interface Organization {
  login: string;
  name: string | null;
  description: string | null;
  avatarUrl: string;
}

const ORGS_QUERY = `
query ViewerOrganizations($after: String) {
  viewer {
    organizations(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { login name description avatarUrl(size: 64) }
    }
  }
}`;

type OrgsResponse = { viewer: { organizations: { nodes: Organization[]; pageInfo: PageInfo } } };

/** Scopes that let a classic token see private organization memberships. */
const ORG_SCOPES = ["read:org", "write:org", "admin:org"];

interface Organizations {
  orgs: Organization[];
  /** The token's OAuth scopes, or null when it has none (fine-grained and GitHub App tokens). */
  scopes: string[] | null;
}

/** Organizations the signed-in user belongs to, with the token scopes that decide which ones it sees. */
async function fetchOrganizations(): Promise<Organizations> {
  const orgs = await gqlAll(async (after) => (await gql<OrgsResponse>(ORGS_QUERY, { after })).viewer.organizations);
  orgs.sort((a, b) => a.login.localeCompare(b.login, undefined, { sensitivity: "base" }));
  return { orgs, scopes: tokenScopes() ?? null };
}

export function OrganizationsPage() {
  useTitle("Organizations");
  const query = useQuery({ queryKey: keys.viewerOrgs(), queryFn: fetchOrganizations });
  const orgs = query.data?.orgs;
  const scopes = query.data?.scopes;
  const missingScope = scopes && !scopes.some((s) => ORG_SCOPES.includes(s));

  return (
    <div className="owner">
      <h2 className="orgs-title">Organizations</h2>
      {query.error && (
        <ErrorBanner
          error={query.error}
          action={
            <button className="btn sm" onClick={() => void query.refetch()}>
              Retry
            </button>
          }
        />
      )}
      {missingScope && (
        <div className="flash error" role="alert">
          Failed to list private organization memberships: your token doesn't have the <code>read:org</code> scope, so only public
          memberships show. Add it to your token in{" "}
          <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer">
            GitHub's token settings
          </a>
          , then reload.
        </div>
      )}
      {scopes === null && orgs && !orgs.length && (
        <div className="flash warn">
          Your token may not be allowed to see your organizations. Fine-grained tokens often list none, even when you belong to some.
        </div>
      )}
      <div className="box owner-box">
        <div className="box-header row owner-header">
          <span className="muted owner-count">{orgs && `${orgs.length.toLocaleString()} ${orgs.length === 1 ? "organization" : "organizations"}`}</span>
          {query.isFetching && <Spinner label="Loading organizations" />}
        </div>
        {orgs && !orgs.length ? (
          <div className="blankslate">No organizations.</div>
        ) : (
          orgs?.map((org) => (
            <div key={org.login} className="box-row orgs-row">
              <Avatar src={org.avatarUrl} size={32} login={org.login} />
              <div className="owner-main">
                <div className="owner-title">
                  <Link className="owner-link truncate" to={`/${org.login}`}>
                    {org.login}
                  </Link>
                  {org.name && org.name !== org.login && <span className="muted truncate">{org.name}</span>}
                </div>
                <div className="muted truncate owner-repo-desc">{org.description}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
