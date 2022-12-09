import React from "react";
import usePermissions from "../../hooks/usePermissions";
import { EventWebHookListContainer } from "./EventWebHookList/EventWebHookList";

export const EventWebHooksPage = () => {
  const permissions = usePermissions();

  if (!permissions.manageWebhooks) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return <EventWebHookListContainer />;
};
