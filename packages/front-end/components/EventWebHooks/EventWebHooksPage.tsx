import React from "react";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { EventWebHookListContainer } from "./EventWebHookList/EventWebHookList";

export const EventWebHooksPage = () => {
  const permissionsUtil = usePermissionsUtil();

  if (
    !permissionsUtil.canCreateWebhook() ||
    !permissionsUtil.canUpdateWebhook() ||
    !permissionsUtil.canDeleteWebhook()
  ) {
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
      <EventWebHookListContainer />
    </div>
  );
};
