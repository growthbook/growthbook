import { z } from "zod";
import { UnionToTuple } from "shared/util";
import {
  NotificationEventName,
  NotificationEventResource,
  ResourceEvents,
  WebhookEntry,
} from "shared/types/events/base-types";
import { apiExperimentValidator, apiFeatureValidator } from "./openapi";
import {
  safeRolloutDecisionNotificationPayload,
  safeRolloutUnhealthyNotificationPayload,
} from "./safe-rollout-notifications";
import {
  rampScheduleStartedPayload,
  rampScheduleStepAdvancedPayload,
  rampScheduleStepApprovalRequiredPayload,
  rampScheduleStepApprovedPayload,
  rampSchedulePausedPayload,
  rampScheduleResumedPayload,
  rampScheduleConflictPayload,
  rampScheduleErrorPayload,
  rampScheduleCompletedPayload,
  rampScheduleRolledBackPayload,
  rampScheduleAutoRollbackPayload,
  rampScheduleCreatedPayload,
  rampScheduleDeletedPayload,
  rampScheduleResetPayload,
  rampScheduleJumpedPayload,
} from "./ramp-schedule-notifications";

import { experimentWarningNotificationPayload } from "./experiment-warnings";
import { experimentInfoSignificance } from "./experiment-info";
import { experimentDecisionNotificationPayload } from "./experiment-decision";
import { userLoginInterface } from "./users";

const eventUserLoggedIn = z
  .object({
    type: z.literal("dashboard"),
    id: z.string(),
    email: z.string(),
    name: z.string(),
  })
  .strict();

export type EventUserLoggedIn = z.infer<typeof eventUserLoggedIn>;

const eventUserApiKey = z
  .object({
    type: z.literal("api_key"),
    apiKey: z.string(),
  })
  .strict();

const eventUserSystem = z.object({
  type: z.literal("system"),
  subtype: z.string().optional(),
  id: z.string().optional(),
});

export type EventUserApiKey = z.infer<typeof eventUserApiKey>;

export const eventUser = z.union([
  eventUserLoggedIn,
  eventUserApiKey,
  eventUserSystem,
  z.null(),
]);

export type EventUser = z.infer<typeof eventUser>;

export const eventData = <T extends z.ZodTypeAny>(data: T) =>
  z
    .object({
      event: z.enum(zodNotificationEventNamesEnum),
      object: z.enum(zodNotificationEventResources),
      data,
      api_version: z.string().regex(/[\d]+-[\d]+-[\d]+/),
      created: z.number(),
      projects: z.array(z.string()),
      environments: z.array(z.string()),
      tags: z.array(z.string()),
      containsSecrets: z.boolean(),
      user: z.union([eventUserLoggedIn, eventUser]),
    })
    .strict();

const webhookTestEventSchema = z.object({ webhookId: z.string() }).strict();

export const notificationEvents = {
  feature: {
    created: {
      schema: apiFeatureValidator,
      description: "Triggered when a feature is created",
    },
    updated: {
      schema: apiFeatureValidator,
      description: "Triggered when a feature is updated",
      isDiff: true,
    },
    deleted: {
      schema: apiFeatureValidator,
      description: "Triggered when a feature is deleted",
    },
    "saferollout.ship": {
      schema: safeRolloutDecisionNotificationPayload,
      description:
        "Triggered when a safe rollout is completed and safe to rollout to 100%.",
    },
    "saferollout.rollback": {
      schema: safeRolloutDecisionNotificationPayload,
      description:
        "Triggered when a safe rollout has a failing guardrail and should be reverted.",
    },
    "saferollout.unhealthy": {
      schema: safeRolloutUnhealthyNotificationPayload,
      description:
        "Triggered when a safe rollout is failing a health check and may not be working as expected.",
    },
  },
  experiment: {
    created: {
      schema: apiExperimentValidator,
      description: "Triggered when an experiment is created",
    },
    updated: {
      schema: apiExperimentValidator,
      description: "Triggered when an experiment is updated",
      isDiff: true,
    },
    deleted: {
      schema: apiExperimentValidator,
      description: "Triggered when an experiment is deleted",
    },
    warning: {
      schema: experimentWarningNotificationPayload,
      description:
        "Triggered when a warning condition is detected on an experiment",
    },
    "info.significance": {
      schema: experimentInfoSignificance,
      description: `Triggered when a goal or guardrail metric reaches significance in an experiment (e.g. either above 95% or below 5% chance to win). Be careful using this without Sequential Testing as it can lead to peeking problems.`,
    },
    "decision.ship": {
      schema: experimentDecisionNotificationPayload,
      description: `Triggered when an experiment is ready to ship a variation.`,
    },
    "decision.rollback": {
      schema: experimentDecisionNotificationPayload,
      description: `Triggered when an experiment should be rolled back to the control.`,
    },
    "decision.review": {
      schema: experimentDecisionNotificationPayload,
      description: `Triggered when an experiment has reached the desired power point, but the results may be ambiguous.`,
    },
  },
  user: {
    login: {
      schema: userLoginInterface,
      description: "Triggered when a user logs in",
      isDiff: false,
    },
  },
  webhook: {
    test: {
      schema: webhookTestEventSchema,
      description: "Triggered when a webhook is being tested",
      isDiff: false,
      noDoc: true,
    },
  },
  rampSchedule: {
    started: {
      schema: rampScheduleStartedPayload,
      description: "Triggered when a ramp schedule starts",
    },
    "step.advanced": {
      schema: rampScheduleStepAdvancedPayload,
      description: "Triggered when a ramp schedule advances to the next step",
    },
    "step.approvalRequired": {
      schema: rampScheduleStepApprovalRequiredPayload,
      description:
        "Triggered when an approval-gated ramp step is waiting for review",
    },
    "step.approved": {
      schema: rampScheduleStepApprovedPayload,
      description:
        "Triggered when an approval gate is cleared and the ramp step proceeds",
    },
    paused: {
      schema: rampSchedulePausedPayload,
      description: "Triggered when a ramp schedule is paused",
    },
    resumed: {
      schema: rampScheduleResumedPayload,
      description: "Triggered when a paused ramp schedule is resumed",
    },
    conflict: {
      schema: rampScheduleConflictPayload,
      description:
        "Triggered when a ramp revision conflict is detected during an approval window",
    },
    error: {
      schema: rampScheduleErrorPayload,
      description:
        "Triggered when an unexpected error occurs during ramp step execution",
    },
    completed: {
      schema: rampScheduleCompletedPayload,
      description: "Triggered when a ramp schedule completes all steps",
    },
    rolledBack: {
      schema: rampScheduleRolledBackPayload,
      description: "Triggered when a ramp schedule is manually rolled back",
    },
    autoRollback: {
      schema: rampScheduleAutoRollbackPayload,
      description:
        "Triggered when a ramp schedule is automatically rolled back by a criteria/metric evaluation",
    },
    created: {
      schema: rampScheduleCreatedPayload,
      description: "Triggered when a ramp schedule is created",
    },
    deleted: {
      schema: rampScheduleDeletedPayload,
      description: "Triggered when a ramp schedule is deleted",
    },
    reset: {
      schema: rampScheduleResetPayload,
      description:
        "Triggered when a ramp schedule is reset to its initial state",
    },
    jumped: {
      schema: rampScheduleJumpedPayload,
      description:
        "Triggered when a ramp schedule is jumped to a specific step",
    },
  },
} as const;

/**
 * Supported resources for event notifications
 */
export const notificationEventResources = Object.keys(
  notificationEvents,
) as NotificationEventResource[];

// Only use this for zod validations!
export const zodNotificationEventResources =
  notificationEventResources as UnionToTuple<NotificationEventResource>;

export const notificationEventNames = (
  Object.keys(notificationEvents) as [NotificationEventResource]
).reduce<NotificationEventName[]>(
  (names, key) => [
    ...names,
    ...Object.keys(notificationEvents[key]).map(
      (name) => `${key}.${name}` as NotificationEventName,
    ),
  ],
  [] as NotificationEventName[],
);

// Only use this for zod validations!
export const zodNotificationEventNamesEnum =
  notificationEventNames as UnionToTuple<NotificationEventName>;

export const notificationEventPayloadData = <
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
>(
  resource: Resource,
  event: Event,
) => {
  const data = notificationEvents[resource][event] as WebhookEntry;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = data.schema as z.ZodObject<any>;

  const ret = z.object({
    object: schema,
    ...(data.isDiff
      ? {
          previous_attributes: schema.partial(),
          changes: z
            .object({
              added: z.record(z.string(), z.unknown()),
              removed: z.record(z.string(), z.unknown()),
              modified: z.record(z.string(), z.unknown()),
            })
            .optional(),
        }
      : {}),
  });

  if (!data.extra) return ret;

  return z.union([ret, data.extra]);
};

export const notificationEventPayload = <
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
>(
  resource: Resource,
  event: Event,
) =>
  z.object({
    event: z.literal(`${resource}.${event}`),
    object: z.literal(resource),
    api_version: z.string(),
    created: z.number(),
    data: notificationEventPayloadData(resource, event),
    user: eventUser,
    tags: z.array(z.string()),
    environments: z.array(z.string()),
    containsSecrets: z.boolean(),
  });
