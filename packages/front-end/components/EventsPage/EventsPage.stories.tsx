import { EventsPage } from "./EventsPage";
import { EventInterface } from "back-end/types/event";
import {
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "back-end/dist/events/base-types";

export default {
  title: "Events/EventsPage",
  component: EventsPage,
};

// NOTE: This story no longer loads because it uses <Code /> which fails, likely due to the dynamic importing with Next JS
export const Default = () => {
  const events: EventInterface<
    NotificationEventPayload<
      NotificationEventName,
      NotificationEventResource,
      unknown
    >
  >[] = [
    {
      id: "event-c5a5af30-f208-4693-a471-056e9ec8ed1f",
      dateCreated: new Date("2022-11-21T22:22:13.949+00:00"),
      organizationId: "org_sktwi1id9l7z9xkjb",
      data: {
        event_id: "event-c5a5af30-f208-4693-a471-056e9ec8ed1f",
        object: "feature",
        event: "feature.updated",
        data: {
          id: "float_feature",
          description: "",
          archived: false,
          dateCreated: "2022-11-09T21:37:45.246Z",
          dateUpdated: "2022-11-21T22:22:13.886Z",
          defaultValue: "3333",
          environments: {
            production: {
              defaultValue: "3333",
              enabled: true,
              rules: [],
              draft: null,
              definition: {
                defaultValue: 3333,
              },
            },
            staging: {
              defaultValue: "3333",
              enabled: true,
              rules: [],
              draft: null,
              definition: {
                defaultValue: 3333,
              },
            },
          },
          owner: "T",
          project: "",
          tags: [],
          valueType: "number",
          revision: {
            comment: "33",
            date: "2022-11-21T22:22:13.886Z",
            publishedBy: "tina@growthbook.io",
            version: 5,
          },
          organizationId: "org_sktwi1id9l7z9xkjb",
        },
      },
    },
    {
      id: "event-eca50a5e-204e-4952-bca2-2bf541950c77",
      dateCreated: new Date("2022-11-18T21:40:15.773+00:00"),
      organizationId: "org_sktwi1id9l7z9xkjb",
      data: {
        event_id: "event-eca50a5e-204e-4952-bca2-2bf541950c77",
        object: "feature",
        event: "feature.updated",
        data: {
          id: "float_feature",
          description: "",
          archived: false,
          dateCreated: "2022-11-09T21:37:45.246Z",
          dateUpdated: "2022-11-21T21:53:39.230Z",
          defaultValue: "2222",
          environments: {
            production: {
              defaultValue: "2222",
              enabled: true,
              rules: [],
              draft: null,
              definition: {
                defaultValue: 2222,
              },
            },
            staging: {
              defaultValue: "2222",
              enabled: true,
              rules: [],
              draft: null,
              definition: {
                defaultValue: 2222,
              },
            },
          },
          owner: "T",
          project: "",
          tags: [],
          valueType: "number",
          revision: {
            comment: "22222222222222",
            date: "2022-11-21T21:53:39.230Z",
            publishedBy: "tina@growthbook.io",
            version: 4,
          },
          organizationId: "org_sktwi1id9l7z9xkjb",
        },
      },
    },
  ];

  return <EventsPage events={events} />;
};
