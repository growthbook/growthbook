import { NotificationEventName } from "back-end/src/events/base-types";

export type EventWebHookEditParams = {
  name: string;
  url: string;
  events: NotificationEventName[];
};

export const eventWebHookEventOptions: {
  id: NotificationEventName;
  name: NotificationEventName;
}[] = [
  {
    id: "feature.updated",
    name: "feature.updated",
  },
  {
    id: "feature.created",
    name: "feature.created",
  },
  {
    id: "feature.deleted",
    name: "feature.deleted",
  },
];
