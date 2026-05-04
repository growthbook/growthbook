import { z } from "zod";
import { UnionToTuple } from "shared/util";
import {
  NotificationEventName,
  NotificationEventResource,
  ResourceEvents,
  WebhookEntry,
} from "shared/types/events/base-types";
import { apiExperimentValidator } from "./experiments";
import { featureWebhookPayload } from "./feature-webhook-schemas";
import {
  safeRolloutDecisionNotificationPayload,
  safeRolloutUnhealthyNotificationPayload,
} from "./safe-rollout-notifications";
import {
  rampScheduleStartedPayload,
  rampScheduleStepAdvancedPayload,
  rampScheduleStepApprovalRequiredPayload,
  rampScheduleCompletedPayload,
  rampScheduleRolledBackPayload,
  rampScheduleCreatedPayload,
  rampScheduleDeletedPayload,
  rampScheduleJumpedPayload,
} from "./ramp-schedule-notifications";
import {
  featureRevisionCreatedPayload,
  featureRevisionUpdatedPayload,
  featureRevisionReviewRequestedPayload,
  featureRevisionReviewApprovedPayload,
  featureRevisionChangesRequestedPayload,
  featureRevisionCommentedPayload,
  featureRevisionDiscardedPayload,
  featureRevisionRebasedPayload,
  featureRevisionPublishedPayload,
  featureRevisionRevertedPayload,
} from "./feature-revision-notifications";

import { experimentWarningNotificationPayload } from "./experiment-warnings";
import { experimentInfoSignificance } from "./experiment-info";
import { experimentDecisionNotificationPayload } from "./experiment-decision";
import { userLoginInterface } from "./users";

// Re-export for consumers of shared/validators
export { eventUser } from "./event-user";
export type {
  EventUser,
  EventUserLoggedIn,
  EventUserApiKey,
} from "./event-user";

import { eventUser, eventUserLoggedIn } from "./event-user";

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

// ---------------------------------------------------------------------------
// Contextual Bandit webhook payloads (P6.6)
//
// These are intentionally minimal — full per-context tree summaries are
// available from the read-only ContextualBanditEvent API endpoints
// (`/api/v1/contextual-bandit-events/:id`). The webhook is a notification
// envelope; subscribers fetch event details on demand.
// ---------------------------------------------------------------------------

const contextualBanditEventRef = z
  .object({
    experimentId: z.string(),
    cbaqId: z.string(),
    contextualBanditEventId: z.string(),
    snapshotId: z.string().optional(),
    phase: z.number().int().min(0),
    date: z.string().describe("ISO 8601 timestamp of the CBE"),
  })
  .strict();

const contextualBanditSnapshotCompletedPayload = contextualBanditEventRef
  .extend({
    weightsWereUpdated: z.boolean(),
    reweight: z.boolean(),
    /** Number of contexts trimmed into the residual "other" bucket. */
    trimmedContexts: z.number().int().min(0).optional(),
    /** Soft warnings from `validateContextualAttributesInPayload`. */
    warnings: z.array(z.string()).optional(),
    error: z.string().optional(),
  })
  .strict();

const contextualBanditWeightsUpdatedPayload = contextualBanditEventRef
  .extend({
    /** Number of leaves in the published tree. */
    leafCount: z.number().int().min(1),
    /** Number of variations being weighted. */
    variationCount: z.number().int().min(1),
  })
  .strict();

const contextualBanditAttributeCoverageDegradedPayload =
  contextualBanditEventRef
    .extend({
      attributes: z.array(
        z.object({
          column: z.string(),
          nullRate: z.number().min(0).max(1),
        }),
      ),
    })
    .strict();

const contextualBanditStageTransitionedPayload = z
  .object({
    experimentId: z.string(),
    fromStage: z.enum(["explore", "exploit", "paused"]),
    toStage: z.enum(["explore", "exploit", "paused"]),
    date: z.string().describe("ISO 8601 timestamp of the transition"),
  })
  .strict();

export const notificationEvents = {
  feature: {
    created: {
      schema: featureWebhookPayload,
      description: "Triggered when a feature is created",
    },
    updated: {
      schema: featureWebhookPayload,
      description: "Triggered when a feature is updated",
      isDiff: true,
    },
    deleted: {
      schema: featureWebhookPayload,
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
    "rampSchedule.created": {
      schema: rampScheduleCreatedPayload,
      description: "Triggered when a ramp schedule is created for a feature",
    },
    "rampSchedule.deleted": {
      schema: rampScheduleDeletedPayload,
      description: "Triggered when a ramp schedule is deleted from a feature",
    },
    "rampSchedule.actions.started": {
      schema: rampScheduleStartedPayload,
      description: "Triggered when a feature ramp schedule starts",
    },
    "rampSchedule.actions.completed": {
      schema: rampScheduleCompletedPayload,
      description: "Triggered when a feature ramp schedule completes all steps",
    },
    "rampSchedule.actions.rolledBack": {
      schema: rampScheduleRolledBackPayload,
      description:
        "Triggered when a feature ramp schedule is rolled back or reset to start",
    },
    "rampSchedule.actions.jumped": {
      schema: rampScheduleJumpedPayload,
      description:
        "Triggered when a feature ramp schedule is jumped to a specific step",
    },
    "rampSchedule.actions.step.advanced": {
      schema: rampScheduleStepAdvancedPayload,
      description:
        "Triggered when a feature ramp schedule advances to the next step",
    },
    "rampSchedule.actions.step.approvalRequired": {
      schema: rampScheduleStepApprovalRequiredPayload,
      description: "Triggered when a feature ramp step is waiting for approval",
    },
    "revision.created": {
      schema: featureRevisionCreatedPayload,
      description:
        "Triggered when a new draft revision is created for a feature",
    },
    "revision.updated": {
      schema: featureRevisionUpdatedPayload,
      description:
        "Triggered when a draft revision is modified (rules, default value, toggles, prerequisites, metadata, etc.). The `change` field indicates the specific kind of mutation.",
    },
    "revision.reviewRequested": {
      schema: featureRevisionReviewRequestedPayload,
      description: "Triggered when a draft revision is submitted for review",
    },
    "revision.approved": {
      schema: featureRevisionReviewApprovedPayload,
      description: "Triggered when a draft revision is approved by a reviewer",
    },
    "revision.changesRequested": {
      schema: featureRevisionChangesRequestedPayload,
      description:
        "Triggered when a reviewer requests changes on a draft revision",
    },
    "revision.commented": {
      schema: featureRevisionCommentedPayload,
      description: "Triggered when a comment is added to a draft revision",
    },
    "revision.discarded": {
      schema: featureRevisionDiscardedPayload,
      description: "Triggered when a draft revision is discarded",
    },
    "revision.rebased": {
      schema: featureRevisionRebasedPayload,
      description:
        "Triggered when a draft revision is rebased onto the latest published version",
    },
    "revision.published": {
      schema: featureRevisionPublishedPayload,
      description:
        "Triggered when a draft revision is published. Overlaps with `feature.updated` but provides revision-specific context (base version, comment, author).",
    },
    "revision.reverted": {
      schema: featureRevisionRevertedPayload,
      description:
        "Triggered when a feature is reverted to a previous published revision",
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
    "contextual_bandit.snapshot.completed": {
      schema: contextualBanditSnapshotCompletedPayload,
      description:
        "Triggered after a contextual bandit snapshot finishes (regardless of whether weights changed).",
    },
    "contextual_bandit.weights.updated": {
      schema: contextualBanditWeightsUpdatedPayload,
      description:
        "Triggered when a contextual bandit snapshot publishes new per-leaf weights for the experiment.",
    },
    "contextual_bandit.attribute_coverage_degraded": {
      schema: contextualBanditAttributeCoverageDegradedPayload,
      description:
        "Triggered when one or more contextual attributes have a high null rate or have stopped appearing in the labeled rows.",
    },
    "contextual_bandit.stage_transitioned": {
      schema: contextualBanditStageTransitionedPayload,
      description:
        "Triggered when a contextual bandit experiment moves between explore/exploit stages.",
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
