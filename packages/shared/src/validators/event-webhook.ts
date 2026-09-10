import { z } from "zod";
import { NotificationEventName } from "shared/types/events/base-types";
import { zodNotificationEventNamesEnum } from "./events";
import { experimentCardFormats } from "./notification-card";

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

export const slackEventWebHookOptions = z
  .object({
    experimentCardFormat: z.enum(experimentCardFormats).optional(),
    experimentDigest: z
      .object({
        frequency: z.enum([
          "off",
          "daily",
          "weekly",
          "monthly",
          "quarterly",
          "custom",
        ]),
        hourUtc: z.number().int().min(0).max(23).optional(),
        dayOfWeekUtc: z.number().int().min(0).max(6).optional(),
        dayOfMonth: z.number().int().min(1).max(28).optional(),
        intervalDays: z.number().int().min(1).max(90).optional(),
      })
      .strict()
      .optional(),
    featureDigest: z
      .object({
        frequency: z.enum([
          "off",
          "daily",
          "weekly",
          "monthly",
          "quarterly",
          "custom",
        ]),
        hourUtc: z.number().int().min(0).max(23).optional(),
        dayOfWeekUtc: z.number().int().min(0).max(6).optional(),
        dayOfMonth: z.number().int().min(1).max(28).optional(),
        intervalDays: z.number().int().min(1).max(90).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SlackEventWebHookOptions = z.infer<typeof slackEventWebHookOptions>;

export type ResolvedSlackDigest = {
  frequency: "off" | "daily" | "weekly" | "monthly" | "quarterly" | "custom";
  hourUtc: number;
  dayOfWeekUtc: number;
  dayOfMonth: number;
  intervalDays: number;
};

const OFF_DIGEST: ResolvedSlackDigest = {
  frequency: "off",
  hourUtc: 14,
  dayOfWeekUtc: 1,
  dayOfMonth: 1,
  intervalDays: 14,
};

const resolveDigest = (
  config: SlackEventWebHookOptions["experimentDigest"],
): ResolvedSlackDigest =>
  config
    ? {
        frequency: config.frequency,
        hourUtc: config.hourUtc ?? 14,
        dayOfWeekUtc: config.dayOfWeekUtc ?? 1,
        dayOfMonth: config.dayOfMonth ?? 1,
        intervalDays: config.intervalDays ?? 14,
      }
    : OFF_DIGEST;

export const resolveExperimentDigest = (
  options: SlackEventWebHookOptions | undefined,
) => resolveDigest(options?.experimentDigest);

export const resolveFeatureDigest = (
  options: SlackEventWebHookOptions | undefined,
) => resolveDigest(options?.featureDigest);

const DAY_MS = 24 * 60 * 60 * 1000;

export const slackDigestNextRunAt = (
  digest: ResolvedSlackDigest,
  from: Date,
): Date | null => {
  if (digest.frequency === "off") return null;
  const hour = Math.max(0, Math.min(23, digest.hourUtc));
  const atHour = (date: Date) =>
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        hour,
      ),
    );
  if (digest.frequency === "custom") {
    return new Date(from.getTime() + Math.max(1, digest.intervalDays) * DAY_MS);
  }
  let day = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  for (let i = 0; i < 400; i++) {
    const candidate = atHour(day);
    const daysInMonth = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const matches =
      digest.frequency === "daily" ||
      (digest.frequency === "weekly" &&
        day.getUTCDay() === digest.dayOfWeekUtc) ||
      ((digest.frequency === "monthly" || digest.frequency === "quarterly") &&
        day.getUTCDate() === Math.min(digest.dayOfMonth, daysInMonth) &&
        (digest.frequency === "monthly" ||
          [0, 3, 6, 9].includes(day.getUTCMonth())));
    if (candidate.getTime() > from.getTime() && matches) return candidate;
    day = new Date(day.getTime() + DAY_MS);
  }
  return null;
};

export const slackDigestNextRunAts = (
  options: SlackEventWebHookOptions | undefined,
  from: Date,
) => ({
  experiment: slackDigestNextRunAt(resolveExperimentDigest(options), from),
  feature: slackDigestNextRunAt(resolveFeatureDigest(options), from),
});

export const slackDigestWindowMs = (digest: ResolvedSlackDigest): number => {
  switch (digest.frequency) {
    case "daily":
      return DAY_MS;
    case "weekly":
      return 7 * DAY_MS;
    case "monthly":
      return 30 * DAY_MS;
    case "quarterly":
      return 90 * DAY_MS;
    case "custom":
      return Math.max(1, digest.intervalDays) * DAY_MS;
    case "off":
      return 7 * DAY_MS;
  }
};

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

export const eventWebHookInterface = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    url: z.string().url(),
    name: z.string().trim().min(2),
    events: z.array(eventNameOrWildcard).min(1),
    enabled: z.boolean(),
    projects: z.array(z.string()),
    tags: z.array(z.string()),
    environments: z.array(z.string()),
    payloadType: z.enum(eventWebHookPayloadTypes),
    method: z.enum(eventWebHookMethods),
    headers: z.record(z.string(), z.string()),
    slack: slackEventWebHookMetadata.optional(),
    slackOptions: slackEventWebHookOptions.optional(),
    nextExperimentDigestAt: z.date().optional(),
    nextFeatureDigestAt: z.date().optional(),
    signingKey: z.string().min(2),
    lastRunAt: z.union([z.date(), z.null()]),
    lastState: z.enum(["none", "success", "error"]),
    lastResponseBody: z.union([z.string(), z.null()]),
  })
  .strict();

export type EventWebHookInterface = z.infer<typeof eventWebHookInterface>;
