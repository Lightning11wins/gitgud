import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { gql, gqlAll, type PageInfo } from "@/api/client";
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

/** Organizations the signed-in user belongs to. Tokens without `read:org` see only public memberships. */
async function fetchOrganizations(): Promise<Organization[]> {
  const orgs = await gqlAll(async (after) => (await gql<OrgsResponse>(ORGS_QUERY, { after })).viewer.organizations);
  return orgs.sort((a, b) => a.login.localeCompare(b.login, undefined, { sensitivity: "base" }));
}

export function OrganizationsPage() {
  useTitle("Organizations");
  const query = useQuery({ queryKey: keys.viewerOrgs(), queryFn: fetchOrganizations });
  const orgs = query.data;

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
      <div className="box owner-box">
        <div className="box-header row owner-header">
          <span className="muted owner-count">{orgs && `${orgs.length.toLocaleString()} organizations`}</span>
          {query.isFetching && <Spinner label="Loading organizations" />}
        </div>
        {orgs && !orgs.length ? (
          <div className="blankslate">You don't belong to any organizations this token can see.</div>
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
