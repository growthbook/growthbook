import Link from "next/link";
import React, { FC } from "react";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { EventWebHookListContainer } from "@/components/EventWebHooks/EventWebHookList/EventWebHookList";

const WebhooksPage: FC = () => {
  const permissionsUtil = usePermissionsUtil();

  const canManageWebhooks =
    permissionsUtil.canCreateEventWebhook() ||
    permissionsUtil.canUpdateEventWebhook() ||
    permissionsUtil.canDeleteEventWebhook();

  if (!canManageWebhooks) {
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
      <div className="pagecontents">
        <EventWebHookListContainer />
        <div className="alert alert-info mt-5">
          Looking for SDK Endpoints? They have moved to the{" "}
          <Link href="/sdks">SDK Connections</Link> page.
        </div>
      </div>
    </div>
  );
};
export default WebhooksPage;
