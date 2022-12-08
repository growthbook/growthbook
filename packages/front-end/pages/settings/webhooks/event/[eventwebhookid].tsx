import { NextPage } from "next";
import { EventWebHookDetailContainer } from "../../../../components/EventWebHooks/EventWebHookDetail/EventWebHookDetail";

const EventWebHookDetailPage: NextPage = () => {
  return (
    <div className="container pagecontents">
      <EventWebHookDetailContainer />
    </div>
  );
};

export default EventWebHookDetailPage;
