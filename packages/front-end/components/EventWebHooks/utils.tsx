import {
  NotificationEventNameOrWildcard,
  notificationEventNames as allNotificationEventNames,
  notificationEvents,
} from "shared/validators";
import React, { ReactNode, useMemo } from "react";
import clsx from "clsx";
import {
  PiQuestionLight,
  PiXSquareLight,
  PiCheckCircleLight,
} from "react-icons/pi";
import {
  EventWebHookPayloadType,
  EventWebHookMethod,
} from "shared/types/event-webhook";
import { VscJson } from "react-icons/vsc";
import { FormatOptionLabelMeta } from "react-select";
import { SingleValue } from "@/components/Forms/SelectField";

export type {
  EventWebHookPayloadType,
  EventWebHookMethod,
} from "shared/types/event-webhook";

export const eventWebHookPayloadTypes = ["json", "slack", "discord"] as const;

export const legacyEventWebHookPayloadTypes = [
  ...eventWebHookPayloadTypes,
  "raw",
] as const;

export const eventWebHookMethods = ["POST", "PUT", "PATCH"] as const;

export type EventWebHookEditParams = {
  name: string;
  url: string;
  enabled: boolean;
  events: NotificationEventNameOrWildcard[];
  tags: string[];
  environments: string[];
  projects: string[];
  payloadType: EventWebHookPayloadType;
  method: EventWebHookMethod;
  headers: string;
};

// Exclude internal/noDoc events (e.g. webhook.test) from user-facing lists
export const notificationEventNames = allNotificationEventNames.filter(
  (name) => {
    const [resource, event] = name.split(".");
    return !(
      notificationEvents as Record<string, Record<string, { noDoc?: boolean }>>
    )[resource]?.[event]?.noDoc;
  },
);

// Build grouped options with wildcards for "select all in group"
// Only supports two levels: "{1}.*" and "{1}.{2}.*"
const buildGroupedEventOptions = () => {
  // Organize: { "feature": { "revision": [...events], "rampSchedule": [...events] } }
  const groups: Record<string, Record<string, string[]>> = {};

  for (const eventName of notificationEventNames) {
    const parts = eventName.split(".");
    const level1 = parts[0]; // "feature", "experiment", etc.
    const level2 = parts[1]; // "revision", "rampSchedule", "created", etc.

    if (!groups[level1]) {
      groups[level1] = {};
    }
    if (!groups[level1][level2]) {
      groups[level1][level2] = [];
    }
    groups[level1][level2].push(eventName);
  }

  const result: Array<{
    label: string;
    options: Array<{
      id: string;
      name: string;
      label: string;
      value: string;
      isWildcard: boolean;
      shouldIndent?: boolean;
    }>;
  }> = [];

  for (const [level1, level2Map] of Object.entries(groups)) {
    const options: Array<{
      id: string;
      name: string;
      label: string;
      value: string;
      isWildcard: boolean;
      shouldIndent?: boolean;
    }> = [];

    // Group events by level 2, adding subgroup wildcards where applicable
    const sortedLevel2 = Object.keys(level2Map).sort();

    // Check if we have subgroups (multi-level events) or multiple top-level events
    const totalTopLevelEvents = Object.values(level2Map).flat().length;
    const hasMultipleTopLevel = totalTopLevelEvents > 1;
    const hasSubgroups = sortedLevel2.some(
      (level2) => level2Map[level2][0]?.split(".").length > 2,
    );

    // Only add top-level wildcard if there are subgroups or multiple events
    if (hasSubgroups || hasMultipleTopLevel) {
      options.push({
        id: `${level1}.*`,
        name: `${level1}.*`,
        label: `All ${level1} events`,
        value: `${level1}.*`,
        isWildcard: true,
      });
    }

    for (const level2 of sortedLevel2) {
      const events = level2Map[level2];

      // If there are multiple events under this level 2, add a wildcard
      if (events.length > 1) {
        options.push({
          id: `${level1}.${level2}.*`,
          name: `${level1}.${level2}.*`,
          label: `${level2}`,
          value: `${level1}.${level2}.*`,
          isWildcard: true,
        });
      }

      // Add individual events
      for (const event of events.sort()) {
        const shouldIndent =
          hasSubgroups || hasMultipleTopLevel || events.length > 1;
        options.push({
          id: event,
          name: event,
          label: event,
          value: event,
          isWildcard: false,
          shouldIndent,
        });
      }
    }

    result.push({
      label: level1,
      options,
    });
  }

  return result;
};

export const eventWebHookEventOptions = buildGroupedEventOptions();

export const formatWebhookEventOptionLabel = (
  option: {
    value: string;
    label: string;
    isWildcard?: boolean;
    shouldIndent?: boolean;
  },
  meta?: FormatOptionLabelMeta<SingleValue>,
) => {
  if (option.isWildcard) {
    const parts = option.value.split(".");
    parts.pop(); // Remove "*"
    const groupName = parts.join(" ");

    return (
      <span>
        {groupName} <span className="text-muted">(All events)</span>
      </span>
    );
  }

  const shouldIndent =
    (option as { shouldIndent?: boolean }).shouldIndent &&
    meta?.context === "menu";
  return <span className={clsx(shouldIndent && "pl-3")}>{option.label}</span>;
};

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
  { text }: { text: boolean } = { text: false },
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

const ImageIcon = ({
  src,
  style,
  className,
}: {
  src: string;
  className: string;
  style: React.CSSProperties;
}) => <img src={src} className={className} style={style} />;

export const WebhookIcon = ({
  style,
  className = "",
  type,
}: {
  style: React.CSSProperties;
  className?: string;
  type: (typeof legacyEventWebHookPayloadTypes)[number];
}) => {
  let invalidType: never;

  switch (type) {
    case "discord":
    case "slack":
    case "raw":
      return (
        <ImageIcon
          src={`/images/${type}-webhook.png`}
          style={style}
          className={className}
        />
      );
    case "json":
      return <VscJson style={style} className={className} />;
    default:
      invalidType = type;
      throw new Error(`Invalid type: ${invalidType}`);
  }
};

export const displayedEvents = (
  events: string[],
  { maxEventsDisplay }: { maxEventsDisplay?: number } = {},
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
    null,
  );
