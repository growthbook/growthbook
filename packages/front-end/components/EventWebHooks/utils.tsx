import { publicNotificationEventNames } from "shared/notifications";
import {
  DatadogEventWebHookSettings,
  NotificationEventNameOrWildcard,
} from "shared/validators";
import { DEFAULT_MAX_WEBHOOK_TIMEOUT_SECONDS } from "shared/constants";
import React from "react";
import clsx from "clsx";
import { PiBracketsCurly } from "react-icons/pi";
import {
  EventWebHookPayloadType,
  EventWebHookMethod,
} from "shared/types/event-webhook";
import { SiDatadog } from "react-icons/si";
import { FormatOptionLabelMeta } from "react-select";
import { Flex } from "@radix-ui/themes";
import { SingleValue } from "@/components/Forms/SelectField";
import Tooltip from "@/ui/Tooltip";
import { isCloud } from "@/services/env";

export type {
  EventWebHookPayloadType,
  EventWebHookMethod,
} from "shared/types/event-webhook";

// In display order.
export const eventWebHookPayloadTypes = [
  "json",
  "slack",
  "discord",
  "datadog",
] as const;

export const legacyEventWebHookPayloadTypes = [
  ...eventWebHookPayloadTypes,
  "raw",
] as const;

export const eventWebHookMethods = ["POST", "PUT", "PATCH"] as const;

export type EventWebHookEditParams = {
  name: string;
  url: string;
  events: NotificationEventNameOrWildcard[];
  tags: string[];
  environments: string[];
  projects: string[];
  payloadType: EventWebHookPayloadType;
  method: EventWebHookMethod;
  headers: string;
  timeoutSeconds?: number | null;
  datadog?: DatadogEventWebHookSettings;
};

// Blank is null rather than undefined so an edit clears the stored value.
// react-hook-form also runs this on a null default value, so null must stay null.
export const timeoutSecondsFromInput = (v: string | null | undefined) =>
  v ? Number(v) : null;

// Self-hosted caps are only known to the server, which rejects the save
export const timeoutError = (n?: number | null) => {
  if (n === null || n === undefined) return undefined;
  if (!Number.isInteger(n) || n < 1) {
    return "Enter a whole number of seconds, at least 1.";
  }
  if (isCloud() && n > DEFAULT_MAX_WEBHOOK_TIMEOUT_SECONDS) {
    return `Enter at most ${DEFAULT_MAX_WEBHOOK_TIMEOUT_SECONDS} seconds.`;
  }
  return undefined;
};

export const notificationEventNames = publicNotificationEventNames;

// Build grouped options with wildcards for "select all in group"
// Only supports two levels: "{1}.*" and "{1}.{2}.*"
export const buildGroupedEventOptions = (
  eventNames: readonly string[] = notificationEventNames,
) => {
  // Organize: { "feature": { "revision": [...events], "rampSchedule": [...events] } }
  const groups: Record<string, Record<string, string[]>> = {};

  for (const eventName of eventNames) {
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

    // Group events by level 2, adding subgroup wildcards where applicable.
    // List direct events (e.g. savedGroup.created/updated/deleted) before
    // nested subgroups (e.g. savedGroup.revision.*) so a top-level event isn't
    // stranded visually after a subgroup's block.
    const isSubgroup = (level2: string) =>
      (level2Map[level2][0]?.split(".").length ?? 0) > 2;
    const sortedLevel2 = Object.keys(level2Map).sort((a, b) => {
      if (isSubgroup(a) !== isSubgroup(b)) return isSubgroup(a) ? 1 : -1;
      return a.localeCompare(b);
    });

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
      return <PiBracketsCurly style={style} className={className} />;
    case "datadog":
      return (
        <SiDatadog
          style={{ color: "#632ca6", ...style }}
          className={className}
        />
      );
    default:
      invalidType = type;
      throw new Error(`Invalid type: ${invalidType}`);
  }
};

export const displayedEvents = (
  events: string[],
  { maxEventsDisplay }: { maxEventsDisplay?: number } = {},
) => {
  const shown = events.slice(0, maxEventsDisplay);
  const hidden = events.slice(shown.length);
  return (
    <>
      {shown.map((event, i) => (
        <React.Fragment key={event}>
          {i > 0 && ", "}
          <code style={{ color: "var(--violet-11)" }}>{event}</code>
        </React.Fragment>
      ))}
      {hidden.length > 0 && (
        <>
          {" and "}
          <Tooltip
            content={
              <Flex direction="column" gap="1">
                {hidden.map((event) => (
                  <code key={event}>{event}</code>
                ))}
              </Flex>
            }
          >
            <span tabIndex={0} style={{ textDecoration: "underline dotted" }}>
              {hidden.length} more
            </span>
          </Tooltip>
        </>
      )}
    </>
  );
};
