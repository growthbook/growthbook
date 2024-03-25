import React from "react";
import { NextPage } from "next";
import { SlackIntegrationsListViewContainer } from "@front-end/components/SlackIntegrations/SlackIntegrationsListView/SlackIntegrationsListView";
import usePermissions from "@front-end/hooks/usePermissions";

const SlackIntegrationsPage: NextPage = () => {
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
  return (
    <div className="container-fluid pagecontents">
      <SlackIntegrationsListViewContainer />
    </div>
  );
};

export default SlackIntegrationsPage;
