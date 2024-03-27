import { NotificationEventName } from "back-end/src/events/base-types";
import React, { ReactNode, useMemo } from "react";
import { BsCheck, BsQuestion, BsX } from "react-icons/bs";
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
  state: "none" | "success" | "error"
): ReactNode =>
  useMemo(() => {
    switch (state) {
      case "none":
        return <BsQuestion className="d-block text-muted" />;
      case "success":
        return <BsCheck className="d-block text-success" />;
      case "error":
        return <BsX className="d-block text-danger" />;
      default:
        return null;
    }
  }, [state]);
