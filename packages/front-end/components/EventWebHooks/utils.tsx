import { NotificationEventName } from "back-end/src/events/base-types";
import React, { ReactNode, useMemo } from "react";
import {
  PiQuestionLight,
  PiXSquareLight,
  PiCheckCircleLight,
} from "react-icons/pi";
import {
  EventWebHookPayloadType,
  EventWebHookMethod,
} from "back-end/types/event-webhook";

export type {
  EventWebHookPayloadType,
  EventWebHookMethod,
} from "back-end/types/event-webhook";

export const eventWebHookPayloadTypes = [
  "raw",
  "slack",
  "discord",
  "ms-teams",
] as const;

export const eventWebHookMethods = ["POST", "PUT", "PATCH"] as const;

export type EventWebHookEditParams = {
  name: string;
  url: string;
  enabled: boolean;
  events: NotificationEventName[];
  tags: string[];
  environments: string[];
  projects: string[];
  payloadType: EventWebHookPayloadType;
  method: EventWebHookMethod;
  headers: string;
};

export const notificationEventNames = [
  // Features
  "feature.created",
  "feature.updated",
  "feature.deleted",
  // Experiments
  "experiment.created",
  "experiment.updated",
  "experiment.deleted",
  "experiment.warning",
  "experiment.info",
  // User
  "user.login",
] as const;

export const eventWebHookEventOptions: {
  id: NotificationEventName;
  name: NotificationEventName;
}[] = [
  // Features
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
  // Experiments
  {
    id: "experiment.created",
    name: "experiment.created",
  },
  {
    id: "experiment.updated",
    name: "experiment.updated",
  },
  {
    id: "experiment.deleted",
    name: "experiment.deleted",
  },
  {
    id: "experiment.warning",
    name: "experiment.warning",
  },
];

export type EventWebHookModalMode =
  | {
      mode: "edit";
      data: EventWebHookEditParams;
    }
  | { mode: "create" };

/**
 * Get the icon for the event web hook state
 * @param state
 */
export const useIconForState = (
  state: "none" | "success" | "error",
  { text }: { text: boolean } = { text: false }
): ReactNode =>
  useMemo(() => {
    let invalidState: never;

    switch (state) {
      case "none": {
        const icon = <PiQuestionLight className="d-block text-muted" />;
        if (text)
          return (
            <span className="p-1 px-2 rounded-pill badge badge-light d-flex align-items-center">
              {icon}{" "}
              <span className="ml-1 mb-0 text-muted font-weight-normal">
                Not ran
              </span>
            </span>
          );
        else return icon;
      }
      case "success": {
        const icon = <PiCheckCircleLight className="d-block text-success" />;
        if (text)
          return (
            <span className="p-1 px-2 rounded-pill badge badge-success-light d-flex align-items-center">
              {icon}{" "}
              <span className="ml-1 mb-0 text-success font-weight-normal">
                Successful
              </span>
            </span>
          );
        else return icon;
      }
      case "error": {
        const icon = <PiXSquareLight className="d-block text-danger" />;
        if (text)
          return (
            <span className="p-1 px-2 rounded-pill badge badge-danger-light d-flex align-items-center">
              {icon}{" "}
              <span className="ml-1 mb-0 text-danger font-weight-normal">
                Failed
              </span>
            </span>
          );
        else return icon;
      }
      default:
        invalidState = state;
        throw new Error(`Invalid state: ${invalidState}`);
    }
  }, [state, text]);

export const webhookIcon = {
  discord: "/images/discord.png",
  slack: "/images/slack.png",
  raw: "/images/raw-webhook.png",
} as const;

export const displayedEvents = (
  events: string[],
  { maxEventsDisplay }: { maxEventsDisplay?: number } = {}
) =>
  [
    ...events
      .slice(0, maxEventsDisplay)
      .map((event) => <code key={event}>{event}</code>),
    ...(maxEventsDisplay && events.length > maxEventsDisplay ? ["..."] : []),
  ].reduce(
    (element, text) => (
      <>
        {element ? <>{element}, </> : null}
        {text}
      </>
    ),
    null
  );
