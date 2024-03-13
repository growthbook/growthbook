import React from "react";
import { NextPage } from "next";
import { EventDetailContainer } from "@front-end/components/Events/EventDetail/EventDetail";

const EventDetailPage: NextPage = () => {
  return (
    <div className="container pagecontents">
      <EventDetailContainer />
    </div>
  );
};

export default EventDetailPage;
