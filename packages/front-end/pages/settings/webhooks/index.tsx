import Link from "next/link";
import React, { FC } from "react";
import { EventWebHooksPage } from "@/components/EventWebHooks/EventWebHooksPage";
import usePermissions from "../../../hooks/usePermissions";

const WebhooksPage: FC = () => {
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
    <div className="container-fluid pagecontents">
      <div className="mt-3">
        <EventWebHooksPage />
      </div>
      <div className="alert alert-info mt-5">
        Looking for SDK Endpoints? They have moved to the{" "}
        <Link href="/sdks">SDK Connections</Link> page.
      </div>
    </div>
  );
};
export default WebhooksPage;
