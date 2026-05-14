import { useCallback } from "react";
import { GithubIntegrationInterface } from "shared/types/github";
import { useAuth } from "@/services/auth";

export default function GithubIntegrationConfig({
  githubIntegration,
  refresh,
}: {
  githubIntegration: GithubIntegrationInterface;
  refresh: () => void;
}) {
  const { apiCall } = useAuth();
  // TODO
  // - need to allow revoking tokens / disconnecting (?)
  // - show error state if refresh token is expired
  const toggleRepo = useCallback(
    async (repoId: string) => {
      await apiCall("/integrations/github/toggle-repo", {
        method: "POST",
        body: JSON.stringify({
          repoId,
        }),
      });
      refresh();
    },
    [apiCall, refresh],
  );
  return (
    <div>
      <h2>Configuration</h2>

      <h3>Repositories to Watch</h3>
      {githubIntegration.repositories.map((repo) => (
        <div key={repo.id}>
          <input
            type="checkbox"
            checked={repo.watching}
            onChange={() => toggleRepo(repo.id)}
          />
          <label>{repo.name}</label>
        </div>
      ))}
    </div>
  );
}
