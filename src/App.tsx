import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { queryClient } from "./api/queryClient";
import { auth } from "./auth/token";
import { Login } from "./auth/Login";
import { Spinner } from "./components/Spinner";
import { Layout } from "./components/Layout";
import { NotFound } from "./components/NotFound";
import { Settings } from "./components/Settings";
import { Dashboard } from "./features/dashboard/Dashboard";
import { IssuePage } from "./features/issue/IssuePage";
import { NewIssuePage } from "./features/issue/NewIssuePage";
import { OrganizationsPage } from "./features/owner/OrganizationsPage";
import { OwnerPage } from "./features/owner/OwnerPage";
import { ComparePage } from "./features/pull/ComparePage";
import { PullPage } from "./features/pull/PullPage";
import { RepoPage } from "./features/repo/RepoPage";
import { useStore } from "./lib/store";

export function App() {
  const { status } = useStore(auth);
  if (status === "loading")
    return (
      <div className="blankslate">
        <Spinner size={20} label="Loading your session" />
      </div>
    );
  if (status === "signed-out") return <Login />;
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/organizations" element={<OrganizationsPage />} />
            <Route path=":owner" element={<OwnerPage />} />
            <Route path=":owner/:repo" element={<RepoPage />} />
            <Route path=":owner/:repo/issues" element={<RepoPage kind="issue" />} />
            <Route path=":owner/:repo/pulls" element={<RepoPage kind="pr" />} />
            <Route path=":owner/:repo/issues/new" element={<NewIssuePage />} />
            <Route path=":owner/:repo/issues/:number" element={<IssuePage />} />
            <Route path=":owner/:repo/pull/:number/*" element={<PullPage />} />
            <Route path=":owner/:repo/compare/*" element={<ComparePage />} />
            <Route path=":owner/:repo/compare" element={<ComparePage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
