import { EventWebHookInterface } from "back-end/types/event-webhook";
import { getValidDate } from "@/services/dates";
import { EventWebHookListItem } from "./EventWebHookListItem";

export default {
  component: EventWebHookListItem,
  title: "Event WebHooks/EventWebHookListItem",
};

export const SuccessfulRun = () => {
  const eventWebHook: EventWebHookInterface = {
    events: ["feature.updated", "feature.created", "feature.deleted"],
    id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e",
    organizationId: "org_sktwi1id9l7z9xkjb",
    name: "My 4th WebHook",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    enabled: false,
    url: "http://192.168.0.15:1115/events/webhooks?v=4",
    signingKey: "ewhk_6220c5592f03244c43a929850816d644",
    lastRunAt: getValidDate(new Date().toString()),
    lastState: "success",
    lastResponseBody: null,
  };

  return (
    <div>
      <EventWebHookListItem
        href="#ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e"
        eventWebHook={eventWebHook}
      />
    </div>
  );
};

export const FailedRun = () => {
  const eventWebHook: EventWebHookInterface = {
    events: ["feature.updated", "feature.created", "feature.deleted"],
    id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e",
    organizationId: "org_sktwi1id9l7z9xkjb",
    name: "My 4th WebHook",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    enabled: false,
    url: "http://192.168.0.15:1115/events/webhooks?v=4",
    signingKey: "ewhk_6220c5592f03244c43a929850816d644",
    lastRunAt: getValidDate(new Date().toString()),
    lastState: "error",
    lastResponseBody: null,
  };

  return (
    <div>
      <EventWebHookListItem
        href="#ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e"
        eventWebHook={eventWebHook}
      />
    </div>
  );
};

export const NoRuns = () => {
  const eventWebHook: EventWebHookInterface = {
    events: ["feature.updated", "feature.created", "feature.deleted"],
    id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e",
    organizationId: "org_sktwi1id9l7z9xkjb",
    name: "My 4th WebHook",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    enabled: false,
    url: "http://192.168.0.15:1115/events/webhooks?v=4",
    signingKey: "ewhk_6220c5592f03244c43a929850816d644",
    lastRunAt: null,
    lastState: "none",
    lastResponseBody: null,
  };

  return (
    <div>
      <EventWebHookListItem
        href="#ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e"
        eventWebHook={eventWebHook}
      />
    </div>
  );
};
