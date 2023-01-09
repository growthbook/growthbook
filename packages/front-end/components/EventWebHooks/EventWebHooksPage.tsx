import React from "react";
import usePermissions from "@/hooks/usePermissions";
import { EventWebHookListContainer } from "./EventWebHookList/EventWebHookList";

export const EventWebHooksPage = () => {
  const permissions = usePermissions();

  if (!permissions.manageWebhooks) {
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
