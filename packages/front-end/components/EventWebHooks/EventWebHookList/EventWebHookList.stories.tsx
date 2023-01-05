import { EventWebHookInterface } from "back-end/types/event-webhook";
import { getValidDate } from "@/services/dates";
import { EventWebHookList } from "./EventWebHookList";

export default {
  component: EventWebHookList,
  title: "Event WebHooks/EventWebHookList",
};

export const Default = () => {
  const eventWebHooks: EventWebHookInterface[] = [
    {
      events: ["feature.updated", "feature.created", "feature.deleted"],
      id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e_1",
      organizationId: "org_sktwi1id9l7z9xkjb",
      name: "My 1st WebHook",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      enabled: false,
      url: "http://192.168.0.15:1115/events/webhooks?v=4",
      signingKey: "ewhk_6220c5592f03244c43a929850816d644",
      lastRunAt: getValidDate(new Date().toString()),
      lastState: "success",
      lastResponseBody: null,
    },
    {
      events: ["feature.updated", "feature.created", "feature.deleted"],
      id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e_2",
      organizationId: "org_sktwi1id9l7z9xkjb",
      name: "My 2nd WebHook",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      enabled: false,
      url: "http://192.168.0.15:1115/events/webhooks?v=4",
      signingKey: "ewhk_6220c5592f03244c43a929850816d644",
      lastRunAt: getValidDate(new Date().toString()),
      lastState: "error",
      lastResponseBody: null,
    },
    {
      events: ["feature.updated", "feature.created", "feature.deleted"],
      id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e_3",
      organizationId: "org_sktwi1id9l7z9xkjb",
      name: "My 3rd WebHook",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      enabled: false,
      url: "http://192.168.0.15:1115/events/webhooks?v=4",
      signingKey: "ewhk_6220c5592f03244c43a929850816d644",
      lastRunAt: null,
      lastState: "none",
      lastResponseBody: null,
    },
  ];

  return (
    <EventWebHookList
      createError={null}
      eventWebHooks={eventWebHooks}
      errorMessage={null}
      isModalOpen={false}
      onModalClose={() => undefined}
      onCreateModalOpen={() => undefined}
      onAdd={() => undefined}
    />
  );
};

export const WithLongUrl = () => {
  const eventWebHooks: EventWebHookInterface[] = [
    {
      events: ["feature.updated", "feature.created", "feature.deleted"],
      id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e_1",
      organizationId: "org_sktwi1id9l7z9xkjb",
      name: "My WebHook with an Extremely Long URL",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      enabled: false,
      url:
        "http://www.foo.bar.baz.growthbook.com/api/v100/vendors/webhooks/features/feature-updated/webhooks?token=8ca47365b8b2499ca7a863d5b5c36b5d",
      signingKey: "ewhk_6220c5592f03244c43a929850816d644",
      lastRunAt: getValidDate(new Date().toString()),
      lastState: "success",
      lastResponseBody: null,
    },
    {
      events: ["feature.updated", "feature.created", "feature.deleted"],
      id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e_2",
      organizationId: "org_sktwi1id9l7z9xkjb",
      name: "Another WebHook with an Extremely Long URL",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      enabled: false,
      url:
        "http://www.foo.bar.baz.growthbook.com/api/v100/vendors/webhooks/features/feature-created/webhooks?token=8ca47365b8b2499ca7a863d5b5c36b5d",
      signingKey: "ewhk_6220c5592f03244c43a929850816d644",
      lastRunAt: getValidDate(new Date().toString()),
      lastState: "error",
      lastResponseBody: null,
    },
    {
      events: ["feature.updated", "feature.created", "feature.deleted"],
      id: "ewh-4af2033e-80e7-45af-a06d-01f3fccc8d1e_3",
      organizationId: "org_sktwi1id9l7z9xkjb",
      name: "Yet Another WebHook with an Extremely Long URL",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      enabled: false,
      url:
        "http://www.foo.bar.baz.growthbook.com/api/v100/vendors/webhooks/features/feature-deleted/webhooks?token=8ca47365b8b2499ca7a863d5b5c36b5d",
      signingKey: "ewhk_6220c5592f03244c43a929850816d644",
      lastRunAt: null,
      lastState: "none",
      lastResponseBody: null,
    },
  ];

  return (
    <EventWebHookList
      createError={null}
      eventWebHooks={eventWebHooks}
      errorMessage={null}
      isModalOpen={false}
      onModalClose={() => undefined}
      onCreateModalOpen={() => undefined}
      onAdd={() => undefined}
    />
  );
};
