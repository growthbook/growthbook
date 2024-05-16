import React from "react";
import { NextPage } from "next";
import { EventWebHookDetailContainer } from "@/components/EventWebHooks/EventWebHookDetail/EventWebHookDetail";
import { EventWebHookLogsContainer } from "@/components/EventWebHooks/EventWebHookLogs/EventWebHookLogs";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const EventWebHookDetailPage: NextPage = () => {
  const permissionsUtil = usePermissionsUtil();

  if (!permissionsUtil.canViewEventWebhook()) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have permission to view this page.
        </div>
      </div>
    );
  }
  return (
    <div className="container pagecontents">
      <EventWebHookDetailContainer />

      <div className="mt-4">
        <EventWebHookLogsContainer />
      </div>
    </div>
  );
};

export default EventWebHookDetailPage;
