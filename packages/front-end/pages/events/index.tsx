import React from "react";
import type { NextPage } from "next";
import { EventsPageContainer } from "@/components/Events/EventsPage/EventsPage";
import SettingsPage from "@/components/Layout/SettingsPage";

const EventsNextPage: NextPage = () => {
  return (
    <SettingsPage title="Events Log" hideHeader>
      <EventsPageContainer />
    </SettingsPage>
  );
};

export default EventsNextPage;
