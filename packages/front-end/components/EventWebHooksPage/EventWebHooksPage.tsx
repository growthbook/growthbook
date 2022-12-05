import React from "react";
import { EventWebHookListContainer } from "./EventWebHookList/EventWebHookList";
import usePermissions from "../../hooks/usePermissions";

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

  return (
    <div>
      <h1>Event Webhooks</h1>
      <p>
        Event Webhooks are event-based, and allow you to monitor specific
        events.
      </p>

      <div className="mt-4">
        <EventWebHookListContainer />
      </div>
    </div>
  );
};
