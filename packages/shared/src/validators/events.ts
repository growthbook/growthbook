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
  rampScheduleErrorPausedPayload,
  rampScheduleStepHeldPayload,
  rampSchedulePausedPayload,
  rampScheduleResumedPayload,
  rampScheduleCreatedPayload,
  rampScheduleDeletedPayload,
  rampScheduleJumpedPayload,
  rampScheduleAwaitingStartApprovalPayload,
  rampScheduleStartApprovedPayload,
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
  featureRevisionRecalledPayload,
  featureRevisionReviewRetractedPayload,
  featureRevisionPublishScheduleChangedPayload,
  featureRevisionRebasedPayload,
  featureRevisionPublishedPayload,
  featureRevisionRevertedPayload,
  featureRevisionPublishFailedPayload,
} from "./feature-revision-notifications";

import { experimentWarningNotificationPayload } from "./experiment-warnings";
import {
  experimentInfoSignificance,
  experimentInfoScheduledStatusUpdate,
} from "./experiment-info";
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
  savedGroupRevisionRecalledPayload,
  savedGroupRevisionReviewRetractedPayload,
  savedGroupRevisionPublishScheduleChangedPayload,
  savedGroupRevisionPublishFailedPayload,
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
  constantRevisionRecalledPayload,
  constantRevisionReviewRetractedPayload,
  constantRevisionPublishScheduleChangedPayload,
  constantRevisionPublishFailedPayload,
} from "./constant-revision-notifications";
import { apiConfigValidator } from "./config";
import {
  configRevisionCreatedPayload,
  configRevisionUpdatedPayload,
  configRevisionReviewRequestedPayload,
  configRevisionApprovedPayload,
  configRevisionChangesRequestedPayload,
  configRevisionCommentedPayload,
  configRevisionDiscardedPayload,
  configRevisionRebasedPayload,
  configRevisionPublishedPayload,
  configRevisionRevertedPayload,
  configRevisionReopenedPayload,
  configRevisionRecalledPayload,
  configRevisionReviewRetractedPayload,
  configRevisionPublishScheduleChangedPayload,
  configRevisionPublishFailedPayload,
} from "./config-revision-notifications";

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
    },
    updated: {
      schema: featureWebhookPayload,
      isDiff: true,
    },
    deleted: {
      schema: featureWebhookPayload,
    },
    "saferollout.ship": {
      schema: safeRolloutDecisionNotificationPayload,
    },
    "saferollout.rollback": {
      schema: safeRolloutDecisionNotificationPayload,
    },
    "saferollout.unhealthy": {
      schema: safeRolloutUnhealthyNotificationPayload,
    },
    "rampSchedule.created": {
      schema: rampScheduleCreatedPayload,
    },
    "rampSchedule.deleted": {
      schema: rampScheduleDeletedPayload,
    },
    "rampSchedule.actions.started": {
      schema: rampScheduleStartedPayload,
    },
    "rampSchedule.actions.completed": {
      schema: rampScheduleCompletedPayload,
    },
    "rampSchedule.actions.rolledBack": {
      schema: rampScheduleRolledBackPayload,
    },
    "rampSchedule.actions.jumped": {
      schema: rampScheduleJumpedPayload,
    },
    "rampSchedule.actions.step.advanced": {
      schema: rampScheduleStepAdvancedPayload,
    },
    "rampSchedule.actions.step.approvalRequired": {
      schema: rampScheduleStepApprovalRequiredPayload,
    },
    "rampSchedule.actions.awaitingStartApproval": {
      schema: rampScheduleAwaitingStartApprovalPayload,
    },
    "rampSchedule.actions.startApproved": {
      schema: rampScheduleStartApprovedPayload,
    },
    "rampSchedule.actions.errorPaused": {
      schema: rampScheduleErrorPausedPayload,
    },
    "rampSchedule.actions.stepHeld": {
      schema: rampScheduleStepHeldPayload,
    },
    "rampSchedule.actions.paused": {
      schema: rampSchedulePausedPayload,
    },
    "rampSchedule.actions.resumed": {
      schema: rampScheduleResumedPayload,
    },
    "revision.created": {
      schema: featureRevisionCreatedPayload,
    },
    "revision.updated": {
      schema: featureRevisionUpdatedPayload,
    },
    "revision.reviewRequested": {
      schema: featureRevisionReviewRequestedPayload,
    },
    "revision.approved": {
      schema: featureRevisionReviewApprovedPayload,
    },
    "revision.changesRequested": {
      schema: featureRevisionChangesRequestedPayload,
    },
    "revision.commented": {
      schema: featureRevisionCommentedPayload,
    },
    "revision.discarded": {
      schema: featureRevisionDiscardedPayload,
    },
    "revision.reopened": {
      schema: featureRevisionReopenedPayload,
    },
    "revision.recalled": {
      schema: featureRevisionRecalledPayload,
    },
    "revision.reviewRetracted": {
      schema: featureRevisionReviewRetractedPayload,
    },
    "revision.publishScheduleChanged": {
      schema: featureRevisionPublishScheduleChangedPayload,
    },
    "revision.rebased": {
      schema: featureRevisionRebasedPayload,
    },
    "revision.published": {
      schema: featureRevisionPublishedPayload,
    },
    "revision.reverted": {
      schema: featureRevisionRevertedPayload,
    },
    "revision.publishFailed": {
      schema: featureRevisionPublishFailedPayload,
    },
  },
  experiment: {
    created: {
      schema: apiExperimentValidator,
    },
    updated: {
      schema: apiExperimentValidator,
      isDiff: true,
    },
    deleted: {
      schema: apiExperimentValidator,
    },
    warning: {
      schema: experimentWarningNotificationPayload,
    },
    "info.significance": {
      schema: experimentInfoSignificance,
    },
    "info.scheduled-status-update": {
      schema: experimentInfoScheduledStatusUpdate,
    },
    "decision.ship": {
      schema: experimentDecisionNotificationPayload,
    },
    "decision.rollback": {
      schema: experimentDecisionNotificationPayload,
    },
    "decision.review": {
      schema: experimentDecisionNotificationPayload,
    },
  },
  savedGroup: {
    created: {
      schema: apiSavedGroupValidator,
    },
    updated: {
      schema: apiSavedGroupValidator,
      isDiff: true,
    },
    deleted: {
      schema: apiSavedGroupValidator,
    },
    "revision.created": {
      schema: savedGroupRevisionCreatedPayload,
    },
    "revision.updated": {
      schema: savedGroupRevisionUpdatedPayload,
    },
    "revision.reviewRequested": {
      schema: savedGroupRevisionReviewRequestedPayload,
    },
    "revision.approved": {
      schema: savedGroupRevisionApprovedPayload,
    },
    "revision.changesRequested": {
      schema: savedGroupRevisionChangesRequestedPayload,
    },
    "revision.commented": {
      schema: savedGroupRevisionCommentedPayload,
    },
    "revision.discarded": {
      schema: savedGroupRevisionDiscardedPayload,
    },
    "revision.rebased": {
      schema: savedGroupRevisionRebasedPayload,
    },
    "revision.published": {
      schema: savedGroupRevisionPublishedPayload,
    },
    "revision.reverted": {
      schema: savedGroupRevisionRevertedPayload,
    },
    "revision.reopened": {
      schema: savedGroupRevisionReopenedPayload,
    },
    "revision.recalled": {
      schema: savedGroupRevisionRecalledPayload,
    },
    "revision.reviewRetracted": {
      schema: savedGroupRevisionReviewRetractedPayload,
    },
    "revision.publishScheduleChanged": {
      schema: savedGroupRevisionPublishScheduleChangedPayload,
    },
    "revision.publishFailed": {
      schema: savedGroupRevisionPublishFailedPayload,
    },
  },
  constant: {
    created: {
      schema: apiConstantValidator,
    },
    updated: {
      schema: apiConstantValidator,
      isDiff: true,
    },
    deleted: {
      schema: apiConstantValidator,
    },
    "revision.created": {
      schema: constantRevisionCreatedPayload,
    },
    "revision.updated": {
      schema: constantRevisionUpdatedPayload,
    },
    "revision.reviewRequested": {
      schema: constantRevisionReviewRequestedPayload,
    },
    "revision.approved": {
      schema: constantRevisionApprovedPayload,
    },
    "revision.changesRequested": {
      schema: constantRevisionChangesRequestedPayload,
    },
    "revision.commented": {
      schema: constantRevisionCommentedPayload,
    },
    "revision.discarded": {
      schema: constantRevisionDiscardedPayload,
    },
    "revision.rebased": {
      schema: constantRevisionRebasedPayload,
    },
    "revision.published": {
      schema: constantRevisionPublishedPayload,
    },
    "revision.reverted": {
      schema: constantRevisionRevertedPayload,
    },
    "revision.reopened": {
      schema: constantRevisionReopenedPayload,
    },
    "revision.recalled": {
      schema: constantRevisionRecalledPayload,
    },
    "revision.reviewRetracted": {
      schema: constantRevisionReviewRetractedPayload,
    },
    "revision.publishScheduleChanged": {
      schema: constantRevisionPublishScheduleChangedPayload,
    },
    "revision.publishFailed": {
      schema: constantRevisionPublishFailedPayload,
    },
  },
  config: {
    created: {
      schema: apiConfigValidator,
    },
    updated: {
      schema: apiConfigValidator,
      isDiff: true,
    },
    deleted: {
      schema: apiConfigValidator,
    },
    "revision.created": {
      schema: configRevisionCreatedPayload,
    },
    "revision.updated": {
      schema: configRevisionUpdatedPayload,
    },
    "revision.reviewRequested": {
      schema: configRevisionReviewRequestedPayload,
    },
    "revision.approved": {
      schema: configRevisionApprovedPayload,
    },
    "revision.changesRequested": {
      schema: configRevisionChangesRequestedPayload,
    },
    "revision.commented": {
      schema: configRevisionCommentedPayload,
    },
    "revision.discarded": {
      schema: configRevisionDiscardedPayload,
    },
    "revision.rebased": {
      schema: configRevisionRebasedPayload,
    },
    "revision.published": {
      schema: configRevisionPublishedPayload,
    },
    "revision.reverted": {
      schema: configRevisionRevertedPayload,
    },
    "revision.reopened": {
      schema: configRevisionReopenedPayload,
    },
    "revision.recalled": {
      schema: configRevisionRecalledPayload,
    },
    "revision.reviewRetracted": {
      schema: configRevisionReviewRetractedPayload,
    },
    "revision.publishScheduleChanged": {
      schema: configRevisionPublishScheduleChangedPayload,
    },
    "revision.publishFailed": {
      schema: configRevisionPublishFailedPayload,
    },
  },
  user: {
    login: {
      schema: userLoginInterface,
      isDiff: false,
    },
  },
  webhook: {
    test: {
      schema: webhookTestEventSchema,
      isDiff: false,
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

/** Non-empty tuple for z.enum that avoids recursive union-to-tuple instantiation. */
export const zodNotificationEventNamesEnum = notificationEventNames as [
  NotificationEventName,
  ...NotificationEventName[],
];

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
              modified: z.array(z.unknown()),
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
