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
  featureRevisionReopenedPayload,
  featureRevisionRebasedPayload,
  featureRevisionPublishedPayload,
  featureRevisionRevertedPayload,
} from "./feature-revision-notifications";

import { experimentWarningNotificationPayload } from "./experiment-warnings";
import { experimentInfoSignificance } from "./experiment-info";
import { experimentDecisionNotificationPayload } from "./experiment-decision";
import { userLoginInterface } from "./users";
import { apiSavedGroupValidator } from "./saved-group";
import {
  savedGroupRevisionCreatedPayload,
  savedGroupRevisionUpdatedPayload,
  savedGroupRevisionReviewRequestedPayload,
  savedGroupRevisionApprovedPayload,
  savedGroupRevisionChangesRequestedPayload,
  savedGroupRevisionCommentedPayload,
  savedGroupRevisionDiscardedPayload,
  savedGroupRevisionRebasedPayload,
  savedGroupRevisionPublishedPayload,
  savedGroupRevisionRevertedPayload,
  savedGroupRevisionReopenedPayload,
} from "./saved-group-revision-notifications";
import { apiConstantValidator } from "./constant";
import {
  constantRevisionCreatedPayload,
  constantRevisionUpdatedPayload,
  constantRevisionReviewRequestedPayload,
  constantRevisionApprovedPayload,
  constantRevisionChangesRequestedPayload,
  constantRevisionCommentedPayload,
  constantRevisionDiscardedPayload,
  constantRevisionRebasedPayload,
  constantRevisionPublishedPayload,
  constantRevisionRevertedPayload,
  constantRevisionReopenedPayload,
} from "./constant-revision-notifications";

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
        "Triggered when a feature ramp schedule advances. Overdue steps are caught up in a single advance: when `currentStepIndex - previousStepIndex > 1`, the intermediate steps were folded into this one event (one revision publish) rather than fired individually.",
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
    "revision.reopened": {
      schema: featureRevisionReopenedPayload,
      description:
        "Triggered when a discarded draft revision is reopened as a draft",
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
  },
  savedGroup: {
    created: {
      schema: apiSavedGroupValidator,
      description: "Triggered when a saved group is created",
    },
    updated: {
      schema: apiSavedGroupValidator,
      description: "Triggered when a saved group is updated",
      isDiff: true,
    },
    deleted: {
      schema: apiSavedGroupValidator,
      description: "Triggered when a saved group is deleted",
    },
    "revision.created": {
      schema: savedGroupRevisionCreatedPayload,
      description:
        "Triggered when a new draft revision is created for a saved group",
    },
    "revision.updated": {
      schema: savedGroupRevisionUpdatedPayload,
      description:
        "Triggered when a draft revision's proposed changes are modified (values, condition, archive, or metadata). The `change` field indicates the kind of mutation.",
    },
    "revision.reviewRequested": {
      schema: savedGroupRevisionReviewRequestedPayload,
      description: "Triggered when a draft revision is submitted for review",
    },
    "revision.approved": {
      schema: savedGroupRevisionApprovedPayload,
      description: "Triggered when a draft revision is approved by a reviewer",
    },
    "revision.changesRequested": {
      schema: savedGroupRevisionChangesRequestedPayload,
      description:
        "Triggered when a reviewer requests changes on a draft revision",
    },
    "revision.commented": {
      schema: savedGroupRevisionCommentedPayload,
      description: "Triggered when a comment is added to a draft revision",
    },
    "revision.discarded": {
      schema: savedGroupRevisionDiscardedPayload,
      description: "Triggered when a draft revision is discarded",
    },
    "revision.rebased": {
      schema: savedGroupRevisionRebasedPayload,
      description:
        "Triggered when a draft revision is rebased onto the latest live state",
    },
    "revision.published": {
      schema: savedGroupRevisionPublishedPayload,
      description:
        "Triggered when a draft revision is published. Overlaps with `savedGroup.updated` but provides revision-specific context.",
    },
    "revision.reverted": {
      schema: savedGroupRevisionRevertedPayload,
      description:
        "Triggered when a saved group is reverted to a previous published revision",
    },
    "revision.reopened": {
      schema: savedGroupRevisionReopenedPayload,
      description: "Triggered when a discarded revision is reopened",
    },
  },
  constant: {
    created: {
      schema: apiConstantValidator,
      description: "Triggered when a constant is created",
    },
    updated: {
      schema: apiConstantValidator,
      description: "Triggered when a constant is updated",
      isDiff: true,
    },
    deleted: {
      schema: apiConstantValidator,
      description: "Triggered when a constant is deleted",
    },
    "revision.created": {
      schema: constantRevisionCreatedPayload,
      description:
        "Triggered when a new draft revision is created for a constant",
    },
    "revision.updated": {
      schema: constantRevisionUpdatedPayload,
      description:
        "Triggered when a draft revision's proposed changes are modified (value, archive, or metadata). The `change` field indicates the kind of mutation.",
    },
    "revision.reviewRequested": {
      schema: constantRevisionReviewRequestedPayload,
      description: "Triggered when a draft revision is submitted for review",
    },
    "revision.approved": {
      schema: constantRevisionApprovedPayload,
      description: "Triggered when a draft revision is approved by a reviewer",
    },
    "revision.changesRequested": {
      schema: constantRevisionChangesRequestedPayload,
      description:
        "Triggered when a reviewer requests changes on a draft revision",
    },
    "revision.commented": {
      schema: constantRevisionCommentedPayload,
      description: "Triggered when a comment is added to a draft revision",
    },
    "revision.discarded": {
      schema: constantRevisionDiscardedPayload,
      description: "Triggered when a draft revision is discarded",
    },
    "revision.rebased": {
      schema: constantRevisionRebasedPayload,
      description:
        "Triggered when a draft revision is rebased onto the latest live state",
    },
    "revision.published": {
      schema: constantRevisionPublishedPayload,
      description:
        "Triggered when a draft revision is published. Overlaps with `constant.updated` but provides revision-specific context.",
    },
    "revision.reverted": {
      schema: constantRevisionRevertedPayload,
      description:
        "Triggered when a constant is reverted to a previous published revision",
    },
    "revision.reopened": {
      schema: constantRevisionReopenedPayload,
      description: "Triggered when a discarded revision is reopened",
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
    environments: z
      .array(z.string())
      .describe(
        "The environments affected by the change described by this event. For live-state events (e.g. `feature.updated`) these are the environments whose effective configuration actually changed; for draft lifecycle events (`*.revision.*`) they are the environments the proposed changes would affect. Webhook environment filters match against this field. An empty array means the event has no environment-scoped impact (it will only be delivered to subscriptions without an environment filter).",
      ),
    containsSecrets: z.boolean(),
  });
