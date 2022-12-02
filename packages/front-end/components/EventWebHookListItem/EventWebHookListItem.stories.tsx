import { EventWebHookListItem } from "./EventWebHookListItem";
import { EventWebHookInterface } from "back-end/types/event-webhook";

export default {
  component: EventWebHookListItem,
  title: "Event WebHooks/EventWebHookListItem",
};

export const Default = () => {
  const eventWebHook: EventWebHookInterface = {
    events: ["feature.updated", "feature.created", "feature.deleted"],
    id: "ewh-089e484a-f8e4-42de-8ad3-1ac708c88c8d",
    organizationId: "org_sktwi1id9l7z9xkjb",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    error: null,
    signingKey: "ewhk-fc580ba5875bb040e022aed14703d098",
    url: "http://192.168.0.15:1115/events/webhooks?v=sb",
  };

  return (
    <div>
      <EventWebHookListItem eventWebHook={eventWebHook} />
    </div>
  );
};
