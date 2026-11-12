import { useNavigate } from "react-router";
import { RepoForkedIcon, RepoIcon, RepoLockedIcon } from "@primer/octicons-react";
import { useOwner, type OwnerRepo } from "@/features/owner/ownerData";
import { repoPath } from "@/lib/githubUrl";
import { CrumbMenu } from "./CrumbMenu";
import { SelectMenu } from "./SelectMenu";

/** Caret next to the repo crumb that opens a menu of the owner's other repos. */
export function RepoSwitcher({ owner, repo }: { owner: string; repo: string }) {
  return (
    <CrumbMenu
      label="Switch repository"
      menu={(anchor, close) => <RepoMenu anchor={anchor} owner={owner} repo={repo} onClose={close} />}
    />
  );
}

/** Mounted only while open, so the owner's repo list loads on first use. */
function RepoMenu({ anchor, owner, repo, onClose }: { anchor: HTMLElement; owner: string; repo: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { data } = useOwner(owner);
  const current = data?.repos.find((r) => r.name.toLowerCase() === repo.toLowerCase())?.name ?? repo;
  return (
    <SelectMenu<OwnerRepo>
      anchor={anchor}
      title="Switch repository"
      placeholder="Search repositories"
      items={data?.repos}
      getKey={(r) => r.name}
      getText={(r) => r.name}
      renderItem={(r) => {
        const Icon = r.visibility === "PRIVATE" ? RepoLockedIcon : r.isFork ? RepoForkedIcon : RepoIcon;
        return (
          <>
            <Icon className="muted" />
            <span className="truncate">{r.name}</span>
          </>
        );
      }}
      initial={[current]}
      onApply={(keys) => navigate(repoPath(owner, keys[0] ?? current))}
      onClose={onClose}
    />
  );
}
