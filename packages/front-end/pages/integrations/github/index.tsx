import { NextPage } from "next";
import { useRouter } from "next/router";
import { GithubIntegrationInterface } from "back-end/types/github";
import { useGrowthBook } from "@growthbook/growthbook-react";
import useApi from "@/hooks/useApi";
import usePermissions from "@/hooks/usePermissions";
import { AppFeatures } from "@/types/app-features";
import GithubIntegrationConfig from "./GithubIntegrationConfig";
import GithubIntegrationConnect from "./GithubIntegrationConnect";

const GitHubIntegrationPage: NextPage = () => {
  const permissions = usePermissions();
  const router = useRouter();
  const tokenId = router.query.t_id as string;
  const growthbook = useGrowthBook<AppFeatures>();

  if (growthbook && growthbook.isOff("github-integration")) {
    router.replace("/404");
  }

  // TODO
  // - display faqs for quick troubleshooting

  const { data, mutate } = useApi<{
    githubIntegration: GithubIntegrationInterface;
  }>("/integrations/github");

  const githubIntegration = data?.githubIntegration;

  if (!permissions.manageIntegrations) {
    return (
      <div className="container-fluid pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <div className="mb-4">
        <div className="d-flex justify-space-between align-items-center">
          <span className="badge badge-purple text-uppercase mr-2">Alpha</span>
          <h1>GitHub Integration</h1>
        </div>
        <p>
          This page is used to manage the GitHub integration. This integration
          allows you to link your GitHub account to your account on this site.
        </p>
        <div className="my-4">
          {githubIntegration ? (
            <GithubIntegrationConfig
              githubIntegration={githubIntegration}
              refresh={mutate}
            />
          ) : (
            <GithubIntegrationConnect tokenId={tokenId} refresh={mutate} />
          )}
        </div>
      </div>
    </div>
  );
};

export default GitHubIntegrationPage;
