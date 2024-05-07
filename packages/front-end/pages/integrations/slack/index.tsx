import React from "react";
import { NextPage } from "next";
import { SlackIntegrationsListViewContainer } from "@/components/SlackIntegrations/SlackIntegrationsListView/SlackIntegrationsListView";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const SlackIntegrationsPage: NextPage = () => {
  const permissionsUtils = usePermissionsUtil();

  if (!permissionsUtils.canManageIntegrations()) {
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
