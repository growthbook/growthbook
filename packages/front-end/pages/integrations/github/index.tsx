import { NextPage } from "next";
import usePermissions from "@/hooks/usePermissions";

const GitHubIntegrationPage: NextPage = () => {
  const permissions = usePermissions();

  if (!permissions.manageIntegrations) {
    return (
      <div className="container-fluid pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  // TODO
  // 1. try loading github user token row for org from db
  // 2. if not found, look for id query param to look up new token
  // 3. if not there, link to github app installtion link
  // 4. display faqs for quick troubleshooting
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
      </div>
    </div>
  );
};

export default GitHubIntegrationPage;
