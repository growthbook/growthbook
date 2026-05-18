import React from "react";
import { NextPage } from "next";
import { SlackIntegrationsListViewContainer } from "@/components/SlackIntegrations/SlackIntegrationsListView/SlackIntegrationsListView";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";

const SlackIntegrationsPage: NextPage = () => {
  const permissionsUtils = usePermissionsUtil();

  if (!permissionsUtils.canManageIntegrations()) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
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
