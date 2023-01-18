import React from "react";
import { NextPage } from "next";
import { SlackIntegrationsListViewContainer } from "@/components/SlackIntegrations/SlackIntegrationsListView/SlackIntegrationsListView";
import usePermissions from "@/hooks/usePermissions";

const SlackIntegrationsPage: NextPage = () => {
  const permissions = usePermissions();

  if (!permissions.manageIntegrations) {
    return (
      <div className="pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }
  return (
    <div className="pagecontents">
      <SlackIntegrationsListViewContainer />
    </div>
  );
};

export default SlackIntegrationsPage;
