import { z } from "zod";
import { NotificationEventName } from "shared/types/events/base-types";
import { zodNotificationEventNamesEnum } from "./events";
import { notificationSettingsSchema } from "./notification-card";

export const eventWebHookPayloadTypes = [
  "raw",
  "json",
  "slack",
  "discord",
] as const;

export type EventWebHookPayloadType = (typeof eventWebHookPayloadTypes)[number];

export const eventWebHookMethods = ["POST", "PUT", "PATCH"] as const;

export type EventWebHookMethod = (typeof eventWebHookMethods)[number];

export const slackEventWebHookMetadata = z
  .object({
    // References SlackWorkspaceConnection within the webhook organization.
    teamId: z.string().optional(),
    channelName: z.string().optional(),
    channelId: z.string().optional(),
    configurationUrl: z.string().url().optional(),
  })
  .strict();

// Matches multi-level wildcard patterns like "feature.*", "feature.revision.*",
// or "savedGroup.revision.*" (resource names may be camelCase).
export const EVENT_WEBHOOK_WILDCARD_PATTERN = /^[a-zA-Z]+(\.[a-zA-Z]+)*\.\*$/;

export const isEventWebhookWildcard = (val: string) =>
  EVENT_WEBHOOK_WILDCARD_PATTERN.test(val);

// A concrete event name or a wildcard subscription pattern (e.g. "feature.*").
// Widens to string; runtime validation is enforced by the Zod schema.
export type NotificationEventNameOrWildcard = NotificationEventName | string;

// Returns all wildcard patterns that could match an event name.
// e.g. "feature.revision.discarded" → ["feature.*", "feature.revision.*"]
export const getWildcardPatternsForEvent = (eventName: string): string[] => {
  const parts = eventName.split(".");
  const wildcards: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    wildcards.push(`${parts.slice(0, i).join(".")}.*`);
  }
  return wildcards;
};

const eventNameOrWildcard = z
  .string()
  .refine(
    (val: string) =>
      zodNotificationEventNamesEnum.includes(val as never) ||
      isEventWebhookWildcard(val),
    {
      message: `Must be a valid event name or wildcard pattern (e.g., "feature.*", "feature.revision.*")`,
    },
  );

export const notificationFiltersSchema = z
  .object({
    events: z.array(eventNameOrWildcard).min(1),
    projects: z.array(z.string()),
    tags: z.array(z.string()),
    environments: z.array(z.string()),
  })
  .strict();

export type NotificationFilters = z.infer<typeof notificationFiltersSchema>;

export const notificationDeliverySchema = z
  .object({
    url: z.string().url(),
    payloadType: z.enum(eventWebHookPayloadTypes),
    method: z.enum(eventWebHookMethods),
    headers: z.record(z.string(), z.string()),
    slack: slackEventWebHookMetadata.optional(),
    notificationSettings: notificationSettingsSchema.optional(),
  })
  .strict();

export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;

export const eventWebHookInterface = notificationFiltersSchema
  .extend(notificationDeliverySchema.shape)
  .extend({
    id: z.string(),
    organizationId: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string().trim().min(2),
    enabled: z.boolean(),
    excludeBookkeepingUpdates: z.boolean().optional(),
    signingKey: z.string().min(2),
    lastRunAt: z.union([z.date(), z.null()]),
    lastState: z.enum(["none", "success", "error"]),
    lastResponseBody: z.union([z.string(), z.null()]),
  });

export type EventWebHookInterface = z.infer<typeof eventWebHookInterface>;

export const eventWebHookRequestBodySchema = notificationFiltersSchema.extend(
  eventWebHookInterface.pick({
    url: true,
    name: true,
    enabled: true,
    payloadType: true,
    method: true,
    headers: true,
  }).shape,
);

export type EventWebHookRequestBody = z.infer<
  typeof eventWebHookRequestBodySchema
>;

export const slackNotificationSettingsBodySchema =
  notificationFiltersSchema.extend(
    eventWebHookInterface.pick({ enabled: true, notificationSettings: true })
      .shape,
  );

export type SlackNotificationSettingsBody = z.infer<
  typeof slackNotificationSettingsBodySchema
>;

export const slackNotificationPreviewBodySchema = z
  .object({
    eventName: z.enum(zodNotificationEventNamesEnum),
    notificationSettings: notificationSettingsSchema,
  })
  .strict();

export type SlackNotificationPreviewBody = z.infer<
  typeof slackNotificationPreviewBodySchema
>;
