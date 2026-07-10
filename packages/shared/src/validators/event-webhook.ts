import { z } from "zod";
import { NotificationEventName } from "shared/types/events/base-types";
import { zodNotificationEventNamesEnum } from "./events";

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
    appId: z.string().optional(),
    teamId: z.string().optional(),
    teamName: z.string().optional(),
    enterpriseId: z.string().optional(),
    enterpriseName: z.string().optional(),
    channelName: z.string().optional(),
    channelId: z.string().optional(),
    configurationUrl: z.string().url().optional(),
    botUserId: z.string().optional(),
    authedUserId: z.string().optional(),
    scope: z.string().optional(),
    isEnterpriseInstall: z.boolean().optional(),
  })
  .strict();

// User-facing Slack bot options (the "simple list of options"). Flat keys in
// one object so adding a toggle later only touches this schema.
export const experimentCardFormats = ["none", "compact", "detailed"] as const;
export const slackEventWebHookOptions = z
  .object({
    // Which results card (if any) to attach to per-event notifications.
    experimentCardFormat: z.enum(experimentCardFormats).optional(),
    // Weekly program scorecard: opt-in + when to deliver (UTC).
    weeklyDigestEnabled: z.boolean().optional(),
    weeklyDigestDayOfWeekUtc: z.number().int().min(0).max(6).optional(), // 0=Sun
    weeklyDigestHourUtc: z.number().int().min(0).max(23).optional(),
    // Only announce milestone events live; route low-signal ones to the digest.
    milestonesOnly: z.boolean().optional(),
  })
  .strict();
export type SlackEventWebHookOptions = z.infer<typeof slackEventWebHookOptions>;

// Low-signal experiment events suppressed from live delivery when a Slack
// channel opts into "milestones only". They still land in the daily/weekly
// digest (which reads events directly). Everything else — started,
// significance, decisions, stopped, SRM/guardrail warnings — is a milestone.
export const LOW_SIGNAL_EXPERIMENT_EVENTS = new Set<string>([
  "experiment.updated",
  "experiment.status.changed",
  "experiment.endingSoon",
  "experiment.stale",
  "experiment.health.noData",
  "experiment.health.queryFailed",
  "experiment.bandit.weightsChanged",
]);

export const isLowSignalExperimentEvent = (eventName: string): boolean =>
  LOW_SIGNAL_EXPERIMENT_EVENTS.has(eventName);

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

// Coalescing window: when > 0, deliveries for chat-style payload types
// (slack, discord) buffer events keyed by the touched object for this many
// milliseconds, then send a single digest message. 0/undefined disables
// (events deliver one-to-one as before).
export const EVENT_WEBHOOK_DEFAULT_COALESCE_WINDOW_MS = 15_000;
export const EVENT_WEBHOOK_MAX_COALESCE_WINDOW_MS = 5 * 60_000;

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
    experiments: z.array(z.string()),
    metrics: z.array(z.string()),
    payloadType: z.enum(eventWebHookPayloadTypes),
    method: z.enum(eventWebHookMethods),
    headers: z.record(z.string(), z.string()),
    slack: slackEventWebHookMetadata.optional(),
    signingKey: z.string().min(2),
    lastRunAt: z.union([z.date(), z.null()]),
    lastState: z.enum(["none", "success", "error"]),
    lastResponseBody: z.union([z.string(), z.null()]),
    coalesceWindowMs: z
      .number()
      .int()
      .min(0)
      .max(EVENT_WEBHOOK_MAX_COALESCE_WINDOW_MS)
      .optional(),
    dailyDigestHourUtc: z.number().int().min(0).max(23).optional(),
    // Slack bot display/digest options. A single object (flat keys) so new
    // toggles are just a new key here — no model/router/controller surgery.
    slackOptions: slackEventWebHookOptions.optional(),
  })
  .strict();

export type EventWebHookInterface = z.infer<typeof eventWebHookInterface>;
