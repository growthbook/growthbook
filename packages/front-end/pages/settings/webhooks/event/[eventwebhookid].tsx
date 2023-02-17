import React from "react";
import { NextPage } from "next";
import { EventWebHookDetailContainer } from "@/components/EventWebHooks/EventWebHookDetail/EventWebHookDetail";
import { EventWebHookLogsContainer } from "@/components/EventWebHooks/EventWebHookLogs/EventWebHookLogs";

const EventWebHookDetailPage: NextPage = () => {
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
