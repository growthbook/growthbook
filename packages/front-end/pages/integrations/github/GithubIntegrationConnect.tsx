import { useEffect, useState } from "react";
import { GithubIntegrationInterface } from "back-end/types/github";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/services/auth";
export default function GithubIntegrationConnect({
  tokenId,
  refresh,
}: {
  tokenId: string;
  refresh: () => void;
}) {
  const { apiCall } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tokenId) return;
    apiCall<{ githubIntegration: GithubIntegrationInterface }>(
      "/integrations/github",
      {
        method: "POST",
        body: JSON.stringify({
          tokenId,
        }),
      }
    )
      .then(() => refresh())
      .catch((e) => {
        setError(e.message);
      });
  }, [apiCall, tokenId, refresh]);

  if (!tokenId) {
    return (
      <div>
        <p>
          The GitHub integration will allow you to access neat features like{" "}
          <strong>Feature Flag Code References</strong> to help identify where
          in your codebase a feature flag is being used.
        </p>
        <a href="https://github.com/apps/growthbook-github-integration/installations/new">
          Install the GitHub Integration
        </a>
      </div>
    );
  }

  if (error)
    return (
      <div>
        <p>There was an error connecting your GitHub account:</p>
        <pre>{error}</pre>
      </div>
    );

  return (
    <div>
      <LoadingSpinner /> Connecting your GrowthBook account to GitHub...
    </div>
  );
}
