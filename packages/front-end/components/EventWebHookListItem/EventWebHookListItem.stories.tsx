import { select } from "@storybook/addon-knobs";
import { EventWebHookListItem } from "./EventWebHookListItem";
import { EventWebHookInterface } from "back-end/types/event-webhook";
import { getValidDate } from "../../services/dates";

export default {
  component: EventWebHookListItem,
  title: "Event WebHooks/EventWebHookListItem",
};

export const Default = () => {
  const lastRunAt = select<string | null>(
    "Last Run",
    [null, new Date().toString()],
    null
  );
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
    lastRunAt: lastRunAt ? getValidDate(lastRunAt) : null,
    lastState: select("Last Run state", ["none", "error", "success"], "none"),
    lastResponseBody: null,
  };

  return (
    <div>
      <EventWebHookListItem
        href="/event-webhooks/ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e"
        eventWebHook={eventWebHook}
      />
    </div>
  );
};
