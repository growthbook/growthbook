import { KnownBlock } from "@slack/types";
import formatNumber from "number-format.js";
import omit from "lodash/omit";
import pick from "lodash/pick";
import isEqual from "lodash/isEqual";
import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "shared/types/events/notification-events";
import { EventInterface } from "shared/types/events/event";
import { SlackIntegrationInterface } from "shared/types/slack-integration";
import {
  ExperimentWarningNotificationPayload,
  ExperimentInfoSignificancePayload,
  ExperimentInfoScheduledStatusUpdatePayload,
  ExperimentDecisionNotificationPayload,
  SafeRolloutDecisionNotificationPayload,
  SafeRolloutUnhealthyNotificationPayload,
  RampScheduleStepApprovalRequiredPayload,
} from "shared/validators";
import {
  DiffResult,
  HierarchicalValue,
  HierarchicalModification,
  SimpleModification,
  ItemFieldChange,
  type ModificationItem,
} from "shared/types/events/diff";
import {
  FilterDataForNotificationEvent,
  getFilterDataForNotificationEvent,
} from "back-end/src/events/handlers/utils";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { getEvent } from "back-end/src/models/EventModel";
import { cancellableFetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";

// region Filtering

export type DataForNotificationEvent = {
  filterData: FilterDataForNotificationEvent;
  slackMessage: SlackMessage;
};

export const getSlackMessageForNotificationEvent = async (
  event: NotificationEvent,
  eventId: string,
): Promise<SlackMessage | null> => {
  let invalidEvent: never;

  switch (event.event) {
    case "user.login":
      return null;

    case "feature.created":
      return buildSlackMessageForFeatureCreatedEvent(
        event.data.object.id,
        eventId,
      );

    case "feature.updated":
      return buildSlackMessageForFeatureUpdatedEvent(
        event.data.object.id,
        eventId,
      );

    case "feature.deleted":
      return buildSlackMessageForFeatureDeletedEvent(
        event.data.object.id,
        eventId,
      );

    case "feature.saferollout.ship":
      return buildSlackMessageForSafeRolloutShipEvent(
        event.data.object,
        eventId,
      );

    case "feature.saferollout.rollback":
      return buildSlackMessageForSafeRolloutRollbackEvent(
        event.data.object,
        eventId,
      );

    case "feature.saferollout.unhealthy":
      return buildSlackMessageForSafeRolloutUnhealthyEvent(
        event.data.object,
        eventId,
      );

    case "experiment.created":
      return await buildSlackMessageForExperimentCreatedEvent(
        event.data.object,
        eventId,
      );

    case "experiment.updated":
      return await buildSlackMessageForExperimentUpdatedEvent(
        event.data.object,
        eventId,
      );

    case "experiment.warning":
      return buildSlackMessageForExperimentWarningEvent(event.data.object);

    case "experiment.info.significance":
      return buildSlackMessageForExperimentInfoSignificanceEvent(
        event.data.object,
      );

    case "experiment.info.scheduled-status-update":
      return buildSlackMessageForExperimentScheduledStatusUpdateEvent(
        event.data.object,
      );

    case "experiment.deleted":
      return await buildSlackMessageForExperimentDeletedEvent(
        event.data.object.name,
        eventId,
      );

    case "experiment.decision.ship":
      return buildSlackMessageForExperimentShipEvent(event.data.object);

    case "experiment.decision.rollback":
      return buildSlackMessageForExperimentRollbackEvent(event.data.object);

    case "experiment.decision.review":
      return buildSlackMessageForExperimentReviewEvent(event.data.object);

    case "webhook.test":
      return buildSlackMessageForWebhookTestEvent(event.data.object.webhookId);

    case "feature.rampSchedule.created":
    case "feature.rampSchedule.deleted":
    case "feature.rampSchedule.actions.started":
    case "feature.rampSchedule.actions.completed":
    case "feature.rampSchedule.actions.rolledBack":
    case "feature.rampSchedule.actions.jumped":
    case "feature.rampSchedule.actions.step.advanced":
    case "feature.rampSchedule.actions.step.approvalRequired":
    case "feature.rampSchedule.actions.awaitingStartApproval":
    case "feature.rampSchedule.actions.startApproved":
      return buildSlackMessageForRampScheduleEvent(
        event.event,
        event.data.object,
        eventId,
      );

    case "feature.revision.created":
    case "feature.revision.updated":
    case "feature.revision.reviewRequested":
    case "feature.revision.approved":
    case "feature.revision.changesRequested":
    case "feature.revision.commented":
    case "feature.revision.discarded":
    case "feature.revision.reopened":
    case "feature.revision.rebased":
    case "feature.revision.published":
    case "feature.revision.reverted":
    case "feature.revision.publishFailed":
      return buildSlackMessageForRevisionEvent(
        event.event,
        event.data.object,
        eventId,
      );

    case "savedGroup.created":
      return buildSlackMessageForSavedGroupCreatedEvent(
        event.data.object,
        eventId,
      );

    case "savedGroup.updated":
      return buildSlackMessageForSavedGroupUpdatedEvent(
        event.data.object,
        eventId,
      );

    case "savedGroup.deleted":
      return buildSlackMessageForSavedGroupDeletedEvent(
        event.data.object,
        eventId,
      );

    case "savedGroup.revision.created":
    case "savedGroup.revision.updated":
    case "savedGroup.revision.reviewRequested":
    case "savedGroup.revision.approved":
    case "savedGroup.revision.changesRequested":
    case "savedGroup.revision.commented":
    case "savedGroup.revision.discarded":
    case "savedGroup.revision.rebased":
    case "savedGroup.revision.published":
    case "savedGroup.revision.reverted":
    case "savedGroup.revision.reopened":
    case "savedGroup.revision.publishFailed":
      return buildSlackMessageForSavedGroupRevisionEvent(
        event.event,
        event.data.object,
        eventId,
      );

    case "constant.created":
      return buildSlackMessageForConstantCreatedEvent(
        event.data.object,
        eventId,
      );

    case "constant.updated":
      return buildSlackMessageForConstantUpdatedEvent(
        event.data.object,
        eventId,
      );

    case "constant.deleted":
      return buildSlackMessageForConstantDeletedEvent(
        event.data.object,
        eventId,
      );

    case "constant.revision.created":
    case "constant.revision.updated":
    case "constant.revision.reviewRequested":
    case "constant.revision.approved":
    case "constant.revision.changesRequested":
    case "constant.revision.commented":
    case "constant.revision.discarded":
    case "constant.revision.rebased":
    case "constant.revision.published":
    case "constant.revision.reverted":
    case "constant.revision.reopened":
    case "constant.revision.publishFailed":
      return buildSlackMessageForConstantRevisionEvent(
        event.event,
        event.data.object,
        eventId,
      );

    case "config.created":
      return buildSlackMessageForConfigCreatedEvent(event.data.object, eventId);

    case "config.updated":
      return buildSlackMessageForConfigUpdatedEvent(event.data.object, eventId);

    case "config.deleted":
      return buildSlackMessageForConfigDeletedEvent(event.data.object, eventId);

    case "config.revision.created":
    case "config.revision.updated":
    case "config.revision.reviewRequested":
    case "config.revision.approved":
    case "config.revision.changesRequested":
    case "config.revision.commented":
    case "config.revision.discarded":
    case "config.revision.rebased":
    case "config.revision.published":
    case "config.revision.reverted":
    case "config.revision.reopened":
    case "config.revision.publishFailed":
      return buildSlackMessageForConfigRevisionEvent(
        event.event,
        event.data.object,
        eventId,
      );

    default:
      invalidEvent = event;
      throw `Invalid event: ${invalidEvent}`;
  }
};

export const getSlackMessageForLegacyNotificationEvent = async (
  event: LegacyNotificationEvent,
  eventId: string,
): Promise<SlackMessage | null> => {
  let invalidEvent: never;

  switch (event.event) {
    case "user.login":
      return null;

    case "feature.created":
      return buildSlackMessageForFeatureCreatedEvent(
        event.data.current.id,
        eventId,
      );

    case "feature.updated":
      return buildSlackMessageForFeatureUpdatedEvent(
        event.data.current.id,
        eventId,
      );

    case "feature.deleted":
      return buildSlackMessageForFeatureDeletedEvent(
        event.data.previous.id,
        eventId,
      );

    case "experiment.created":
      return await buildSlackMessageForExperimentCreatedEvent(
        event.data.current,
        eventId,
      );

    case "experiment.updated":
      return await buildSlackMessageForExperimentUpdatedEvent(
        event.data.current,
        eventId,
      );

    case "experiment.warning":
      return buildSlackMessageForExperimentWarningEvent(event.data);

    case "experiment.deleted":
      return await buildSlackMessageForExperimentDeletedEvent(
        event.data.previous.name,
        eventId,
      );

    case "webhook.test":
      return buildSlackMessageForWebhookTestEvent(event.data.webhookId);

    default:
      invalidEvent = event;
      throw `Invalid event: ${invalidEvent}`;
  }
};

export const getSlackDataForNotificationEvent = async (
  event: EventInterface,
): Promise<DataForNotificationEvent | null> => {
  if (event.event === "webhook.test") return null;

  const filterData = getFilterDataForNotificationEvent(event.data);
  if (!filterData) return null;

  const slackMessage = await (event.version
    ? getSlackMessageForNotificationEvent(event.data, event.id)
    : getSlackMessageForLegacyNotificationEvent(event.data, event.id));

  if (!slackMessage) return null;

  return { filterData, slackMessage };
};

// endregion Filtering -> feature

// endregion Filtering

// region Slack API

/**
 * GrowthBook Slack context that should be appended to all messages
 * @param slackIntegration
 */
export const getSlackIntegrationContextBlock = (
  slackIntegration: SlackIntegrationInterface,
): KnownBlock => {
  return {
    type: "context",
    elements: [
      {
        type: "image",
        image_url:
          "https://github.com/growthbook/growthbook/blob/main/packages/front-end/public/logo/Logo-mark.png?raw=true",
        alt_text: "GrowthBook logo",
      },
      {
        type: "plain_text",
        text: `This was sent from your Slack integration: ${slackIntegration.name}`,
      },
    ],
  };
};

// region Event-specific messages

// region Event-specific messages -> Feature

export const getFeatureUrlFormatted = (featureId: string): string =>
  `\n• <${APP_ORIGIN}/features/${featureId}|View Feature>`;

export const getEventUrlFormatted = (eventId: string): string =>
  `\n• <${APP_ORIGIN}/events/${eventId}|View Event>`;

export const getEventUserFormatted = async (eventId: string) => {
  const event = await getEvent(eventId);

  if (!event || !event.data?.user) return "an unknown user";

  const { user } = event.data;

  if (user.type === "system") return "an automated process";

  const name = ("name" in user && user.name) || undefined;
  const email = ("email" in user && user.email) || undefined;
  const isApi = user.type === "api_key";

  if (!name && !email && isApi) {
    return `an API request with key ending in ...${user.apiKey.slice(-4)}`;
  }

  const label =
    name && email ? `${name} (${email})` : (name ?? email ?? "unknown");
  return isApi ? `${label} (via API)` : `${label}`;
};

const buildSlackMessageForFeatureCreatedEvent = async (
  featureId: string,
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);

  const text = `The feature ${featureId} has been created by ${eventUser}`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The feature *${featureId}* has been created by ${eventUser}.` +
            getFeatureUrlFormatted(featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForFeatureUpdatedEvent = async (
  featureId: string,
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const event = await getEvent(eventId);

  let changeBlocks: KnownBlock[] = [];

  // Check if we have changes (diff) to format
  if (event?.data?.data && "changes" in event.data.data) {
    const formattedDiff = formatDiffForSlack(
      event.data.data.changes as DiffResult,
      {
        itemLabelFields: [
          "type",
          "value",
          "coverage",
          "condition",
          "savedGroupTargeting",
          "prerequisites",
        ],
      },
    );
    changeBlocks = formattedDiff.blocks;
  }

  const isUnknownUser = eventUser === "an unknown user";
  const text = `The feature ${featureId} has been updated ${isUnknownUser ? "automatically" : `by ${eventUser}`}`;

  // If no change blocks, show a fallback message
  if (changeBlocks.length === 0) {
    changeBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "_Changes cannot be displayed here._",
        },
      },
    ];
  }

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The feature *${featureId}* has been updated ${isUnknownUser ? "automatically" : `by ${eventUser}`}.` +
            getFeatureUrlFormatted(featureId) +
            getEventUrlFormatted(eventId),
        },
      },
      ...changeBlocks,
    ],
  };
};

const buildSlackMessageForFeatureDeletedEvent = async (
  featureId: string,
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const text = `The feature ${featureId} has been deleted by ${eventUser}.`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The feature *${featureId}* has been deleted by ${eventUser}.` +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForSafeRolloutShipEvent = (
  data: SafeRolloutDecisionNotificationPayload,
  eventId: string,
): SlackMessage => {
  const text = `A Safe Rollout on feature ${data.featureId} in environment ${data.environment} is ready to ship to 100% of traffic.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text +
            getFeatureUrlFormatted(data.featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForSafeRolloutRollbackEvent = (
  data: SafeRolloutDecisionNotificationPayload,
  eventId: string,
): SlackMessage => {
  const text = `A Safe Rollout on feature ${data.featureId} in environment ${data.environment} has a failing guardrail and should be rolled back.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text +
            getFeatureUrlFormatted(data.featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForSafeRolloutUnhealthyEvent = (
  data: SafeRolloutUnhealthyNotificationPayload,
  eventId: string,
): SlackMessage => {
  const text = `A Safe Rollout on feature ${data.featureId} in environment ${data.environment} is failing a health check and may not be working as expected.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text +
            getFeatureUrlFormatted(data.featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

// endregion Event-specific messages -> Feature

// region Event-specific messages -> Ramp Schedule

type RampBasePayload = {
  rampName: string;
  currentStepIndex?: number;
  targetStepIndex?: number;
};

const buildSlackMessageForRampScheduleEvent = (
  eventType: string,
  data: RampBasePayload & Partial<RampScheduleStepApprovalRequiredPayload>,
  eventId: string,
): SlackMessage => {
  const name = `*${data.rampName}*`;
  const step = (data.currentStepIndex ?? -1) + 1;
  const jumpTarget = (data.targetStepIndex ?? 0) + 1;

  let text: string;
  switch (eventType) {
    case "feature.rampSchedule.created":
      text = `Ramp schedule ${name} was created`;
      break;
    case "feature.rampSchedule.deleted":
      text = `Ramp schedule ${name} was deleted`;
      break;
    case "feature.rampSchedule.actions.started":
      text = `Ramp schedule ${name} has started`;
      break;
    case "feature.rampSchedule.actions.completed":
      text = `Ramp schedule ${name} has completed`;
      break;
    case "feature.rampSchedule.actions.rolledBack":
      text = `Ramp schedule ${name} was rolled back to start`;
      break;
    case "feature.rampSchedule.actions.jumped":
      text = `Ramp schedule ${name} jumped to step ${jumpTarget}`;
      break;
    case "feature.rampSchedule.actions.step.advanced":
      text = `Ramp schedule ${name} advanced to step ${step}`;
      break;
    case "feature.rampSchedule.actions.step.approvalRequired":
      text = `Ramp schedule ${name} step ${step} requires approval`;
      break;
    case "feature.rampSchedule.actions.awaitingStartApproval":
      text = `Ramp schedule ${name} is awaiting start approval`;
      break;
    case "feature.rampSchedule.actions.startApproved":
      text = `Ramp schedule ${name} start was approved`;
      break;
    default:
      text = `Ramp schedule ${name}: ${eventType}`;
  }

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: text + getEventUrlFormatted(eventId),
      },
    },
  ];

  if (
    eventType === "feature.rampSchedule.actions.step.approvalRequired" &&
    data.approvalNotes
  ) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Approval notes:* ${data.approvalNotes}` },
    });
  }

  return { text, blocks };
};

// endregion Event-specific messages -> Ramp Schedule

// region Event-specific messages -> Feature Revision

type RevisionSlackData = {
  featureId: string;
  version: number;
  reviewComment?: string | null;
  reviewer?: { id?: string; name?: string; email?: string };
  revertedToVersion?: number;
  failureReason?: string;
  terminal?: boolean;
  attempts?: number;
};

// Shared suffix for a `*.revision.publishFailed` Slack message: the reason plus
// whether it was terminal or gave up after N retries.
const formatPublishFailedSuffix = (data: {
  failureReason?: string;
  terminal?: boolean;
  attempts?: number;
}): string => {
  const cause = data.terminal
    ? "won't retry"
    : `gave up after ${data.attempts ?? 0} attempts`;
  const reason = data.failureReason ? ` — _${data.failureReason}_` : "";
  return ` (${cause})${reason}`;
};

const buildSlackMessageForRevisionEvent = (
  eventType: string,
  data: RevisionSlackData,
  eventId: string,
): SlackMessage => {
  const feature = `*${data.featureId}*`;
  const version = `v${data.version}`;
  const reviewerName = data.reviewer?.name || data.reviewer?.email || "someone";
  const commentSuffix = data.reviewComment ? ` — _${data.reviewComment}_` : "";

  let text: string;
  switch (eventType) {
    case "feature.revision.created":
      text = `Draft revision ${version} created for feature ${feature}`;
      break;
    case "feature.revision.updated":
      text = `Draft revision ${version} of feature ${feature} was updated`;
      break;
    case "feature.revision.reviewRequested":
      text = `Review requested for revision ${version} of feature ${feature}${commentSuffix}`;
      break;
    case "feature.revision.approved":
      text = `Revision ${version} of feature ${feature} approved by ${reviewerName}${commentSuffix}`;
      break;
    case "feature.revision.changesRequested":
      text = `Changes requested on revision ${version} of feature ${feature} by ${reviewerName}${commentSuffix}`;
      break;
    case "feature.revision.commented":
      text = `Comment on revision ${version} of feature ${feature} by ${reviewerName}${commentSuffix}`;
      break;
    case "feature.revision.discarded":
      text = `Draft revision ${version} of feature ${feature} was discarded`;
      break;
    case "feature.revision.reopened":
      text = `Discarded revision ${version} of feature ${feature} was reopened as a draft`;
      break;
    case "feature.revision.rebased":
      text = `Draft revision ${version} of feature ${feature} was rebased`;
      break;
    case "feature.revision.published":
      text = `Revision ${version} of feature ${feature} was published`;
      break;
    case "feature.revision.reverted":
      text = `Feature ${feature} was reverted to revision v${data.revertedToVersion ?? "?"}`;
      break;
    case "feature.revision.publishFailed":
      text = `Scheduled publish of revision ${version} for feature ${feature} failed${formatPublishFailedSuffix(data)}`;
      break;
    default:
      text = `Feature ${feature} revision ${version}: ${eventType}`;
  }

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text +
            getFeatureUrlFormatted(data.featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

// endregion Event-specific messages -> Feature Revision

// region Event-specific messages -> Saved Group

export const getSavedGroupUrlFormatted = (savedGroupId: string): string =>
  `\n• <${APP_ORIGIN}/saved-groups/${savedGroupId}|View Saved Group>`;

const buildSlackMessageForSavedGroupCreatedEvent = async (
  savedGroup: { id: string; name: string },
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const text = `The saved group ${savedGroup.name} has been created by ${eventUser}.`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The saved group *${savedGroup.name}* has been created by ${eventUser}.` +
            getSavedGroupUrlFormatted(savedGroup.id) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForSavedGroupUpdatedEvent = async (
  savedGroup: { id: string; name: string },
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const event = await getEvent(eventId);

  let changeBlocks: KnownBlock[] = [];
  if (event?.data?.data && "changes" in event.data.data) {
    const formattedDiff = formatDiffForSlack(
      event.data.data.changes as DiffResult,
      {
        itemLabelFields: [
          "name",
          "condition",
          "values",
          "projects",
          "archived",
        ],
      },
    );
    changeBlocks = formattedDiff.blocks;
  }

  const isUnknownUser = eventUser === "an unknown user";
  const text = `The saved group ${savedGroup.name} has been updated ${isUnknownUser ? "automatically" : `by ${eventUser}`}`;

  if (changeBlocks.length === 0) {
    changeBlocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text: "_Changes cannot be displayed here._" },
      },
    ];
  }

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The saved group *${savedGroup.name}* has been updated ${isUnknownUser ? "automatically" : `by ${eventUser}`}.` +
            getSavedGroupUrlFormatted(savedGroup.id) +
            getEventUrlFormatted(eventId),
        },
      },
      ...changeBlocks,
    ],
  };
};

const buildSlackMessageForSavedGroupDeletedEvent = async (
  savedGroup: { id: string; name: string },
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const text = `The saved group ${savedGroup.name} has been deleted by ${eventUser}.`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The saved group *${savedGroup.name}* has been deleted by ${eventUser}.` +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

type SavedGroupRevisionSlackData = {
  version?: number;
  baseSavedGroup: { id: string; name: string };
  change?: string;
  reviewComment?: string | null;
  reviewer?: { id?: string; name?: string; email?: string };
  revertedToVersion?: number;
  failureReason?: string;
  terminal?: boolean;
  attempts?: number;
};

const buildSlackMessageForSavedGroupRevisionEvent = (
  eventType: string,
  data: SavedGroupRevisionSlackData,
  eventId: string,
): SlackMessage => {
  const group = `*${data.baseSavedGroup.name}*`;
  const version = `v${data.version ?? "?"}`;
  const reviewerName = data.reviewer?.name || data.reviewer?.email || "someone";
  const commentSuffix = data.reviewComment ? ` — _${data.reviewComment}_` : "";

  let text: string;
  switch (eventType) {
    case "savedGroup.revision.created":
      text = `Draft revision ${version} created for saved group ${group}`;
      break;
    case "savedGroup.revision.updated":
      text = `Draft revision ${version} of saved group ${group} was updated${data.change ? ` (${data.change})` : ""}`;
      break;
    case "savedGroup.revision.reviewRequested":
      text = `Review requested for revision ${version} of saved group ${group}`;
      break;
    case "savedGroup.revision.approved":
      text = `Revision ${version} of saved group ${group} approved by ${reviewerName}${commentSuffix}`;
      break;
    case "savedGroup.revision.changesRequested":
      text = `Changes requested on revision ${version} of saved group ${group} by ${reviewerName}${commentSuffix}`;
      break;
    case "savedGroup.revision.commented":
      text = `Comment on revision ${version} of saved group ${group} by ${reviewerName}${commentSuffix}`;
      break;
    case "savedGroup.revision.discarded":
      text = `Draft revision ${version} of saved group ${group} was discarded`;
      break;
    case "savedGroup.revision.rebased":
      text = `Draft revision ${version} of saved group ${group} was rebased`;
      break;
    case "savedGroup.revision.published":
      text = `Revision ${version} of saved group ${group} was published`;
      break;
    case "savedGroup.revision.reverted":
      text = `Saved group ${group} was reverted${data.revertedToVersion ? ` to revision v${data.revertedToVersion}` : ""}`;
      break;
    case "savedGroup.revision.reopened":
      text = `Draft revision ${version} of saved group ${group} was reopened`;
      break;
    case "savedGroup.revision.publishFailed":
      text = `Scheduled publish of revision ${version} for saved group ${group} failed${formatPublishFailedSuffix(data)}`;
      break;
    default:
      text = `Saved group ${group} revision ${version}: ${eventType}`;
  }

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text +
            getSavedGroupUrlFormatted(data.baseSavedGroup.id) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

// endregion Event-specific messages -> Saved Group

// region Event-specific messages -> Constant

// The detail page is addressed by the constant's `key`, not its internal id.
export const getConstantUrlFormatted = (constantKey: string): string =>
  `\n• <${APP_ORIGIN}/constants/${constantKey}|View Constant>`;

const buildSlackMessageForConstantCreatedEvent = async (
  constant: { id: string; name: string; key: string },
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const text = `The constant ${constant.name} has been created by ${eventUser}.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The constant *${constant.name}* has been created by ${eventUser}.` +
            getConstantUrlFormatted(constant.key) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForConstantUpdatedEvent = async (
  constant: { id: string; name: string; key: string },
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const event = await getEvent(eventId);

  let changeBlocks: KnownBlock[] = [];
  if (event?.data?.data && "changes" in event.data.data) {
    const formattedDiff = formatDiffForSlack(
      event.data.data.changes as DiffResult,
      {
        itemLabelFields: [
          "name",
          "value",
          "environmentValues",
          "description",
          "project",
          "archived",
        ],
      },
    );
    changeBlocks = formattedDiff.blocks;
  }

  const isUnknownUser = eventUser === "an unknown user";
  const text = `The constant ${constant.name} has been updated ${isUnknownUser ? "automatically" : `by ${eventUser}`}`;

  if (changeBlocks.length === 0) {
    changeBlocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text: "_Changes cannot be displayed here._" },
      },
    ];
  }

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The constant *${constant.name}* has been updated ${isUnknownUser ? "automatically" : `by ${eventUser}`}.` +
            getConstantUrlFormatted(constant.key) +
            getEventUrlFormatted(eventId),
        },
      },
      ...changeBlocks,
    ],
  };
};

const buildSlackMessageForConstantDeletedEvent = async (
  constant: { id: string; name: string },
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const text = `The constant ${constant.name} has been deleted by ${eventUser}.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The constant *${constant.name}* has been deleted by ${eventUser}.` +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

type ConstantRevisionSlackData = {
  version?: number;
  baseConstant: { id: string; name: string; key: string };
  change?: string;
  reviewComment?: string | null;
  reviewer?: { id?: string; name?: string; email?: string };
  revertedToVersion?: number;
  failureReason?: string;
  terminal?: boolean;
  attempts?: number;
};

const buildSlackMessageForConstantRevisionEvent = (
  eventType: string,
  data: ConstantRevisionSlackData,
  eventId: string,
): SlackMessage => {
  const name = `*${data.baseConstant.name}*`;
  const version = `v${data.version ?? "?"}`;
  const reviewerName = data.reviewer?.name || data.reviewer?.email || "someone";
  const commentSuffix = data.reviewComment ? ` — _${data.reviewComment}_` : "";

  let text: string;
  switch (eventType) {
    case "constant.revision.created":
      text = `Draft revision ${version} created for constant ${name}`;
      break;
    case "constant.revision.updated":
      text = `Draft revision ${version} of constant ${name} was updated${data.change ? ` (${data.change})` : ""}`;
      break;
    case "constant.revision.reviewRequested":
      text = `Review requested for revision ${version} of constant ${name}`;
      break;
    case "constant.revision.approved":
      text = `Revision ${version} of constant ${name} approved by ${reviewerName}${commentSuffix}`;
      break;
    case "constant.revision.changesRequested":
      text = `Changes requested on revision ${version} of constant ${name} by ${reviewerName}${commentSuffix}`;
      break;
    case "constant.revision.commented":
      text = `Comment on revision ${version} of constant ${name} by ${reviewerName}${commentSuffix}`;
      break;
    case "constant.revision.discarded":
      text = `Draft revision ${version} of constant ${name} was discarded`;
      break;
    case "constant.revision.rebased":
      text = `Draft revision ${version} of constant ${name} was rebased`;
      break;
    case "constant.revision.published":
      text = `Revision ${version} of constant ${name} was published`;
      break;
    case "constant.revision.reverted":
      text = `Constant ${name} was reverted${data.revertedToVersion ? ` to revision v${data.revertedToVersion}` : ""}`;
      break;
    case "constant.revision.reopened":
      text = `Draft revision ${version} of constant ${name} was reopened`;
      break;
    case "constant.revision.publishFailed":
      text = `Scheduled publish of revision ${version} for constant ${name} failed${formatPublishFailedSuffix(data)}`;
      break;
    default:
      text = `Constant ${name} revision ${version}: ${eventType}`;
  }

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text +
            getConstantUrlFormatted(data.baseConstant.key) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

// endregion Event-specific messages -> Constant

// region Event-specific messages -> Config

// The detail page is addressed by the config's `key`, not its internal id.
export const getConfigUrlFormatted = (configKey: string): string =>
  `\n• <${APP_ORIGIN}/configs/${configKey}|View Config>`;

const buildSlackMessageForConfigCreatedEvent = async (
  config: { id: string; name: string; key: string },
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const text = `The config ${config.name} has been created by ${eventUser}.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The config *${config.name}* has been created by ${eventUser}.` +
            getConfigUrlFormatted(config.key) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForConfigUpdatedEvent = async (
  config: { id: string; name: string; key: string },
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const event = await getEvent(eventId);

  let changeBlocks: KnownBlock[] = [];
  if (event?.data?.data && "changes" in event.data.data) {
    const formattedDiff = formatDiffForSlack(
      event.data.data.changes as DiffResult,
      {
        itemLabelFields: [
          "name",
          "value",
          "description",
          "project",
          "schema",
          "archived",
        ],
      },
    );
    changeBlocks = formattedDiff.blocks;
  }

  const isUnknownUser = eventUser === "an unknown user";
  const text = `The config ${config.name} has been updated ${isUnknownUser ? "automatically" : `by ${eventUser}`}`;

  if (changeBlocks.length === 0) {
    changeBlocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text: "_Changes cannot be displayed here._" },
      },
    ];
  }

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The config *${config.name}* has been updated ${isUnknownUser ? "automatically" : `by ${eventUser}`}.` +
            getConfigUrlFormatted(config.key) +
            getEventUrlFormatted(eventId),
        },
      },
      ...changeBlocks,
    ],
  };
};

const buildSlackMessageForConfigDeletedEvent = async (
  config: { id: string; name: string },
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const text = `The config ${config.name} has been deleted by ${eventUser}.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The config *${config.name}* has been deleted by ${eventUser}.` +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

type ConfigRevisionSlackData = {
  version?: number;
  baseConfig: { id: string; name: string; key: string };
  change?: string;
  reviewComment?: string | null;
  reviewer?: { id?: string; name?: string; email?: string };
  revertedToVersion?: number;
  failureReason?: string;
  terminal?: boolean;
  attempts?: number;
};

const buildSlackMessageForConfigRevisionEvent = (
  eventType: string,
  data: ConfigRevisionSlackData,
  eventId: string,
): SlackMessage => {
  const name = `*${data.baseConfig.name}*`;
  const version = `v${data.version ?? "?"}`;
  const reviewerName = data.reviewer?.name || data.reviewer?.email || "someone";
  const commentSuffix = data.reviewComment ? ` — _${data.reviewComment}_` : "";

  let text: string;
  switch (eventType) {
    case "config.revision.created":
      text = `Draft revision ${version} created for config ${name}`;
      break;
    case "config.revision.updated":
      text = `Draft revision ${version} of config ${name} was updated${data.change ? ` (${data.change})` : ""}`;
      break;
    case "config.revision.reviewRequested":
      text = `Review requested for revision ${version} of config ${name}`;
      break;
    case "config.revision.approved":
      text = `Revision ${version} of config ${name} approved by ${reviewerName}${commentSuffix}`;
      break;
    case "config.revision.changesRequested":
      text = `Changes requested on revision ${version} of config ${name} by ${reviewerName}${commentSuffix}`;
      break;
    case "config.revision.commented":
      text = `Comment on revision ${version} of config ${name} by ${reviewerName}${commentSuffix}`;
      break;
    case "config.revision.discarded":
      text = `Draft revision ${version} of config ${name} was discarded`;
      break;
    case "config.revision.rebased":
      text = `Draft revision ${version} of config ${name} was rebased`;
      break;
    case "config.revision.published":
      text = `Revision ${version} of config ${name} was published`;
      break;
    case "config.revision.reverted":
      text = `Config ${name} was reverted${data.revertedToVersion ? ` to revision v${data.revertedToVersion}` : ""}`;
      break;
    case "config.revision.reopened":
      text = `Draft revision ${version} of config ${name} was reopened`;
      break;
    case "config.revision.publishFailed":
      text = `Scheduled publish of revision ${version} for config ${name} failed${formatPublishFailedSuffix(data)}`;
      break;
    default:
      text = `Config ${name} revision ${version}: ${eventType}`;
  }

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text +
            getConfigUrlFormatted(data.baseConfig.key) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

// endregion Event-specific messages -> Config

// region Event-specific messages -> Experiment

export const getExperimentUrlFormatted = (experimentId: string): string =>
  `\n• <${APP_ORIGIN}/experiment/${experimentId}|View Experiment>`;

export const getExperimentUrlAndNameFormatted = (
  experimentId: string,
  experimentName: string,
): string => `<${APP_ORIGIN}/experiment/${experimentId}|${experimentName}>`;

const buildSlackMessageForExperimentCreatedEvent = async (
  { id: experimentId, name: experimentName }: { id: string; name: string },
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const isUnknownUser = eventUser === "an unknown user";
  const text = `The experiment ${experimentName} has been created ${isUnknownUser ? "automatically" : `by ${eventUser}`}`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The experiment *${experimentName}* has been created ${isUnknownUser ? "automatically" : `by ${eventUser}`}.` +
            getExperimentUrlFormatted(experimentId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentUpdatedEvent = async (
  { id: experimentId, name: experimentName }: { id: string; name: string },
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const event = await getEvent(eventId);

  let changeBlocks: KnownBlock[] = [];

  // Check if we have changes (diff) to format
  if (event?.data?.data && "changes" in event.data.data) {
    const metricClassifier = (item: unknown) => {
      if (typeof item === "object" && item !== null && "metricId" in item) {
        const metricId = (item as Record<string, unknown>).metricId;
        if (typeof metricId === "string") {
          if (metricId.startsWith("mg_")) {
            return "metric group";
          } else if (metricId.startsWith("met_")) {
            return "metric";
          }
        }
      }
      return null;
    };
    const formattedDiff = formatDiffForSlack(
      event.data.data.changes as DiffResult,
      {
        itemLabelFields: [
          "name",
          "description",
          "status",
          "hypothesis",
          "metrics",
        ],
        arrayIdFields: {
          variations: "variationId",
          phases: "__index",
        },
        arrayIgnoredFields: {
          variations: ["screenshots", "dom", "css", "js"],
          phases: ["dateStarted", "dateEnded"],
        },
        countArrayFields: ["*"],
        arrayItemNames: {
          goals: "metric",
          secondaryMetrics: "metric",
          guardrails: "metric",
        },
        arrayItemClassifiers: {
          goals: metricClassifier,
          secondaryMetrics: metricClassifier,
          guardrails: metricClassifier,
        },
        arrayZeroBasedIndex: {
          variations: true,
        },
        fieldFormatters: {
          trafficSplit: (val: unknown) => {
            if (Array.isArray(val)) {
              const weights = val.map((item: unknown) => {
                if (
                  typeof item === "object" &&
                  item !== null &&
                  "weight" in item
                ) {
                  return (item as Record<string, unknown>).weight;
                }
                return item;
              });
              return `\`[${weights.join(", ")}]\``;
            }
            return `\`${JSON.stringify(val)}\``;
          },
          resultSummary: (val: unknown) => {
            if (typeof val === "object" && val !== null) {
              const obj = val as Record<string, unknown>;
              const lines: string[] = [];

              // Get current experiment data to look up variation index
              const eventData = event?.data?.data as Record<string, unknown>;
              const currentExperiment = eventData?.object as Record<
                string,
                unknown
              >;
              const variations =
                (currentExperiment?.variations as unknown[]) || [];

              if (obj.status) {
                lines.push(`- status: \`"${obj.status}"\``);
              }

              // Skip winner if empty
              if (obj.winner && obj.winner !== "") {
                // Look up variation index from variations array
                const variationIndex = variations.findIndex(
                  (v: unknown) =>
                    typeof v === "object" &&
                    v !== null &&
                    (v as Record<string, unknown>).variationId === obj.winner,
                );
                const displayIndex =
                  variationIndex >= 0 ? variationIndex : obj.winner;
                lines.push(`- winner: \`${displayIndex}\``);
              }

              // Skip conclusions if empty
              if (obj.conclusions && obj.conclusions !== "") {
                lines.push(`- conclusions: "${obj.conclusions}"`);
              }

              if (obj.releasedVariationId) {
                // Look up variation index from variations array
                const variationIndex = variations.findIndex(
                  (v: unknown) =>
                    typeof v === "object" &&
                    v !== null &&
                    (v as Record<string, unknown>).variationId ===
                      obj.releasedVariationId,
                );
                const displayIndex =
                  variationIndex >= 0
                    ? variationIndex
                    : obj.releasedVariationId;
                lines.push(`- releasedVariationId: \`${displayIndex}\``);
              }

              if (obj.excludeFromPayload !== undefined) {
                lines.push(
                  `- excludeFromPayload: \`${obj.excludeFromPayload}\``,
                );
              }

              return "\n" + lines.join("\n");
            }
            return `\`${JSON.stringify(val)}\``;
          },
          // Individual resultSummary property formatters (for hierarchical modifications)
          status: (val: unknown) => `\`"${val}"\``,
          conclusions: (val: unknown) => `\`"${val}"\``,
          winner: (val: unknown) => {
            if (typeof val === "string" && val !== "") {
              // Get current experiment data to look up variation index
              const eventData = event?.data?.data as Record<string, unknown>;
              const currentExperiment = eventData?.object as Record<
                string,
                unknown
              >;
              const variations =
                (currentExperiment?.variations as unknown[]) || [];
              const variationIndex = variations.findIndex(
                (v: unknown) =>
                  typeof v === "object" &&
                  v !== null &&
                  (v as Record<string, unknown>).variationId === val,
              );
              return variationIndex >= 0 ? `\`${variationIndex}\`` : "none";
            }
            return "none";
          },
          releasedVariationId: (val: unknown) => {
            if (typeof val === "string" && val !== "") {
              // Get current experiment data to look up variation index
              const eventData = event?.data?.data as Record<string, unknown>;
              const currentExperiment = eventData?.object as Record<
                string,
                unknown
              >;
              const variations =
                (currentExperiment?.variations as unknown[]) || [];
              const variationIndex = variations.findIndex(
                (v: unknown) =>
                  typeof v === "object" &&
                  v !== null &&
                  (v as Record<string, unknown>).variationId === val,
              );
              return variationIndex >= 0 ? `\`${variationIndex}\`` : "none";
            }
            return "none";
          },
          excludeFromPayload: (val: unknown) => `\`${val}\``,
        },
      },
    );
    changeBlocks = formattedDiff.blocks;
  }

  const isUnknownUser = eventUser === "an unknown user";
  const text = `The experiment ${experimentName} has been updated ${isUnknownUser ? "automatically" : `by ${eventUser}`}`;

  // If no change blocks, show a fallback message
  if (changeBlocks.length === 0) {
    changeBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "_Changes cannot be displayed here._",
        },
      },
    ];
  }

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The experiment *${experimentName}* has been updated ${isUnknownUser ? "automatically" : `by ${eventUser}`}.` +
            getExperimentUrlFormatted(experimentId) +
            getEventUrlFormatted(eventId),
        },
      },
      ...changeBlocks,
    ],
  };
};

const buildSlackMessageForWebhookTestEvent = (
  webhookId: string,
): SlackMessage => ({
  text: `This is a test event for webhook ${webhookId}`,
  blocks: [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `This is a *test event* for ${webhookId}`,
      },
    },
  ],
});

const buildSlackMessageForExperimentDeletedEvent = async (
  experimentName: string,
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const isUnknownUser = eventUser === "an unknown user";
  const text = `The experiment ${experimentName} has been deleted ${isUnknownUser ? "automatically" : `by ${eventUser}`}`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The experiment *${experimentName}* has been deleted ${isUnknownUser ? "automatically" : `by ${eventUser}`}.` +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentInfoSignificanceEvent = ({
  metricName,
  experimentName,
  experimentId,
  variationName,
  statsEngine,
  criticalValue,
  winning,
}: ExperimentInfoSignificancePayload): SlackMessage => {
  const percentFormatter = (v: number) => {
    if (v > 0.99) {
      return ">99%";
    }
    if (v < 0.01) {
      return "<1%";
    }
    return formatNumber("#0.%", v * 100);
  };

  const text = ({
    metricName,
    variationName,
    experimentName,
  }: {
    metricName: string;
    variationName: string;
    experimentName: string;
  }) => {
    if (statsEngine === "frequentist") {
      return `In experiment ${experimentName}: metric ${metricName} for variation ${variationName} is ${
        winning ? "beating" : "losing to"
      } the baseline and has reached statistical significance (p-value = ${criticalValue.toFixed(
        3,
      )}).`;
    }
    return `In experiment ${experimentName}: metric ${metricName} for variation ${variationName} has ${
      winning ? "reached a" : "dropped to a"
    } ${percentFormatter(criticalValue)} chance to beat the baseline.`;
  };

  return {
    text: text({ metricName, experimentName, variationName }),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: text({
            metricName: `*${metricName}*`,
            experimentName: getExperimentUrlAndNameFormatted(
              experimentId,
              experimentName,
            ),
            variationName: `*${variationName}*`,
          }),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentScheduledStatusUpdateEvent = (
  data: ExperimentInfoScheduledStatusUpdatePayload,
): SlackMessage => {
  const shippedVariation = data.shippedVariationName ?? data.shippedVariationId;
  const recommendedVariation =
    data.recommendedVariationName ?? data.recommendedVariationId;

  const text = (experimentName: string): string => {
    switch (data.action) {
      case "started":
        return `Experiment ${experimentName} was automatically started as scheduled.`;
      case "stopped":
        if (data.shipped && shippedVariation) {
          return data.forced
            ? `Experiment ${experimentName} reached its scheduled end date with no clear winner; the pre-selected variation "${shippedVariation}" was shipped.`
            : `Experiment ${experimentName} reached its scheduled end date and the winning variation "${shippedVariation}" was automatically shipped.`;
        }
        return `Experiment ${experimentName} was automatically stopped at its scheduled end date. No variation was shipped.`;
      case "kept-running":
        return recommendedVariation
          ? `Experiment ${experimentName} reached its scheduled end date and was kept running. Recommended variation to ship: "${recommendedVariation}".`
          : `Experiment ${experimentName} reached its scheduled end date and was kept running. There is no clear winner yet.`;
      default: {
        const exhaustiveCheck: never = data.action;
        return exhaustiveCheck;
      }
    }
  };

  return {
    text: text(data.experimentName),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text(`*${data.experimentName}*`) +
            getExperimentUrlFormatted(data.experimentId),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentWarningEvent = (
  data: ExperimentWarningNotificationPayload,
): SlackMessage => {
  let invalidData: never;

  switch (data.type) {
    case "auto-update": {
      const makeText = (name: string) =>
        `Automatic snapshot creation for ${name} ${
          data.success ? "succeeded" : "failed"
        }!`;

      return {
        text: makeText(data.experimentName),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                makeText(`*${data.experimentName}*`) +
                getExperimentUrlFormatted(data.experimentId),
            },
          },
        ],
      };
    }

    case "multiple-exposures": {
      const numberFormatter = (v: number) => formatNumber("#,##0.", v);
      const percentFormatter = (v: number) => formatNumber("#0.%", v * 100);

      const text = (experimentName: string) =>
        `Multiple Exposures Warning for experiment ${experimentName}: ${numberFormatter(
          data.usersCount,
        )} users (${percentFormatter(
          data.percent,
        )}) saw multiple variations and were automatically removed from results.`;

      return {
        text: text(data.experimentName),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                text(`*${data.experimentName}*`) +
                getExperimentUrlFormatted(data.experimentId),
            },
          },
        ],
      };
    }

    case "srm": {
      const text = (experimentName: string) =>
        `Traffic imbalance detected for experiment detected for experiment ${experimentName} : Sample Ratio Mismatch (SRM) p-value below ${data.threshold}.`;

      return {
        text: text(data.experimentName),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                text(`*${data.experimentName}*`) +
                getExperimentUrlFormatted(data.experimentId),
            },
          },
        ],
      };
    }

    case "no-data": {
      const text = (experimentName: string) =>
        `No data yet for experiment ${experimentName}. The most recent update ran successfully but returned no results. Make sure your experiment is tracking properly.`;

      return {
        text: text(data.experimentName),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                text(`*${data.experimentName}*`) +
                getExperimentUrlFormatted(data.experimentId),
            },
          },
        ],
      };
    }

    case "underpowered": {
      const text = (experimentName: string) =>
        `Experiment ${experimentName} is underpowered. Statistical power is below the configured threshold. Consider increasing traffic, using a more sensitive metric, or accepting a larger minimum detectable effect.`;

      return {
        text: text(data.experimentName),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                text(`*${data.experimentName}*`) +
                getExperimentUrlFormatted(data.experimentId),
            },
          },
        ],
      };
    }

    case "scheduled-status-update-failed": {
      const action =
        data.scheduledStatusUpdateType === "start" ? "start" : "stop";
      const tail = data.willRetry
        ? `Will retry (attempt ${data.attempts} of ${data.maxAttempts}).`
        : `Giving up after ${data.attempts} attempts; the schedule has been cleared and the experiment will not ${action} automatically.`;
      const text = (experimentName: string) =>
        `Scheduled ${action} for experiment ${experimentName} failed: ${data.reason}. ${tail}`;

      return {
        text: text(data.experimentName),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                text(`*${data.experimentName}*`) +
                getExperimentUrlFormatted(data.experimentId),
            },
          },
        ],
      };
    }

    default:
      invalidData = data;
      throw `Invalid data: ${invalidData}`;
  }
};

const buildSlackMessageForExperimentShipEvent = (
  data: ExperimentDecisionNotificationPayload,
): SlackMessage => {
  const text = (experimentName: string, description?: string) =>
    `Experiment ${experimentName} has reached the "Ship now" status.${
      description ? ` ${description}` : ""
    }`;
  return {
    text: text(data.experimentName, data.decisionDescription),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text(`*${data.experimentName}*`, data.decisionDescription) +
            getExperimentUrlFormatted(data.experimentId),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentRollbackEvent = (
  data: ExperimentDecisionNotificationPayload,
): SlackMessage => {
  const text = (experimentName: string, description?: string) =>
    `Experiment ${experimentName} has reached the "Roll back now" status.${
      description ? ` ${description}` : ""
    }`;
  return {
    text: text(data.experimentName, data.decisionDescription),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text(`*${data.experimentName}*`, data.decisionDescription) +
            getExperimentUrlFormatted(data.experimentId),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentReviewEvent = (
  data: ExperimentDecisionNotificationPayload,
): SlackMessage => {
  const text = (experimentName: string, description?: string) =>
    `Experiment ${experimentName} has reached the "Ready for review" status.${
      description ? ` ${description}` : ""
    }`;
  return {
    text: text(data.experimentName, data.decisionDescription),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text(`*${data.experimentName}*`, data.decisionDescription) +
            getExperimentUrlFormatted(data.experimentId),
        },
      },
    ],
  };
};

// endregion Event-specific messages -> Experiment

// endregion Event-specific messages

export type SlackMessage = {
  text: string;
  blocks: KnownBlock[];
};

/**
 * Sends a Slack message.
 * @param slackMessage
 * @param webHookEndpoint
 * @throws Error If the request fails
 */
export const sendSlackMessage = async (
  slackMessage: SlackMessage,
  webHookEndpoint: string,
): Promise<boolean> => {
  try {
    const { stringBody, responseWithoutBody } = await cancellableFetch(
      webHookEndpoint,
      {
        method: "POST",
        body: JSON.stringify(slackMessage),
      },
      {
        maxTimeMs: 15000,
        maxContentSize: 500,
      },
    );

    if (!responseWithoutBody.ok) {
      logger.error(
        {
          text: stringBody,
        },
        "Failed to send Slack integration message",
      );
    }

    return responseWithoutBody.ok;
  } catch (e) {
    logger.error(e);
    return false;
  }
};

// endregion Slack API

// beginregion Slack diff formatter

export interface FormatOptions {
  itemLabelFields?: string[];
  includeRawJson?: boolean;
  maxJsonLength?: number;
  excludedFields?: string[];
  arrayIdFields?: Record<string, string>;
  arrayIgnoredFields?: Record<string, string[]>;
  countArrayFields?: string[];
  arrayItemNames?: Record<string, string>;
  arrayItemClassifiers?: Record<string, (item: unknown) => string | null>;
  arrayZeroBasedIndex?: Record<string, boolean>;
  fieldFormatters?: Record<string, (value: unknown) => string>;
}

const isSimpleModification = (
  mod: ModificationItem,
): mod is SimpleModification => {
  return "oldValue" in mod && "newValue" in mod;
};

const isHierarchicalModification = (
  mod: ModificationItem,
): mod is HierarchicalModification => {
  return "values" in mod;
};

export function formatDiffForSlack(
  diff: DiffResult,
  options?: FormatOptions,
): SlackMessage {
  const blocks: SlackMessage["blocks"] = [];

  const opts: Required<FormatOptions> = {
    itemLabelFields: [],
    excludedFields: ["dateUpdated", "date", "__v", "_id"],
    includeRawJson: false,
    maxJsonLength: 600,
    ...(options || {}),
  } as Required<FormatOptions>;

  const excludedFields = opts.excludedFields;

  const toOneBased = (n: number | undefined): number | undefined =>
    typeof n === "number" ? n + 1 : undefined;

  const truncate = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;

  const tryGet = (obj: unknown, field: string): unknown =>
    obj && typeof obj === "object" && field in (obj as Record<string, unknown>)
      ? (obj as Record<string, unknown>)[field]
      : undefined;

  const isEmpty = (value: unknown): boolean => {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" || trimmed === "{}" || trimmed === "[]";
    }
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
  };

  const formatPrimitiveArrayChanges = (
    key: string,
    oldItems: unknown[],
    newItems: unknown[],
    indent: string = "",
    prefix: string = "•",
  ): string[] => {
    const changes: string[] = [];

    // Check for added items
    newItems.forEach((newItem, _index) => {
      if (!oldItems.includes(newItem)) {
        changes.push(
          `${indent}${prefix} Added ${key.slice(0, -1)}: \`${newItem}\``,
        );
      }
    });

    // Check for removed items
    oldItems.forEach((oldItem, _index) => {
      if (!newItems.includes(oldItem)) {
        changes.push(
          `${indent}${prefix} Removed ${key.slice(0, -1)}: \`${oldItem}\``,
        );
      }
    });

    return changes;
  };

  const formatCountArrayChange = (
    key: string,
    oldItems: unknown[],
    newItems: unknown[],
    itemName: string = "item",
  ): string => {
    const oldCount = oldItems.length;
    const newCount = newItems.length;

    // Check if we have a classifier for this field
    const classifier = opts.arrayItemClassifiers?.[key];
    if (classifier) {
      const oldClassified: Record<string, number> = {};
      oldItems.forEach((item) => {
        const classification = classifier(item);
        if (classification) {
          oldClassified[classification] =
            (oldClassified[classification] || 0) + 1;
        }
      });

      const newClassified: Record<string, number> = {};
      newItems.forEach((item) => {
        const classification = classifier(item);
        if (classification) {
          newClassified[classification] =
            (newClassified[classification] || 0) + 1;
        }
      });

      const allTypes = new Set([
        ...Object.keys(oldClassified),
        ...Object.keys(newClassified),
      ]);
      const changes: string[] = [];

      for (const type of allTypes) {
        const oldTypeCount = oldClassified[type] || 0;
        const newTypeCount = newClassified[type] || 0;

        if (oldTypeCount !== newTypeCount) {
          const diff = newTypeCount - oldTypeCount;
          const action = diff > 0 ? "added" : "removed";
          const absDiff = Math.abs(diff);
          changes.push(
            `${action} ${absDiff} ${type}${absDiff === 1 ? "" : "s"} (${oldTypeCount} → ${newTypeCount})`,
          );
        }
      }

      if (changes.length === 0) {
        changes.push(
          `modified ${oldCount} ${itemName}${oldCount === 1 ? "" : "s"} (${oldCount} → ${newCount})`,
        );
      }
      return changes.join(", ");
    }

    if (oldCount === 0 && newCount > 0) {
      return `added ${newCount} ${itemName}${newCount === 1 ? "" : "s"} (0 → ${newCount})`;
    } else if (oldCount > 0 && newCount === 0) {
      return `removed ${oldCount} ${itemName}${oldCount === 1 ? "" : "s"} (${oldCount} → 0)`;
    } else if (oldCount !== newCount) {
      const diff = newCount - oldCount;
      const action = diff > 0 ? "added" : "removed";
      const absDiff = Math.abs(diff);
      return `${action} ${absDiff} ${itemName}${absDiff === 1 ? "" : "s"} (${oldCount} → ${newCount})`;
    } else {
      return `modified ${oldCount} ${itemName}${oldCount === 1 ? "" : "s"} (${oldCount} → ${newCount})`;
    }
  };

  const formatArrayChanges = (
    key: string,
    oldItems: Record<string, unknown>[],
    newItems: Record<string, unknown>[],
    idField: string,
    indent: string = "",
    prefix: string = "•",
    ignoredFields: string[] = [],
  ): string[] => {
    const oldMap = new Map(
      oldItems.map((item, index) => [item[idField] || index, item]),
    );
    const newMap = new Map(
      newItems.map((item, index) => [item[idField] || index, item]),
    );

    const changes: string[] = [];

    // Check for added items
    newItems.forEach((newItem, index) => {
      const id = newItem[idField] || index;
      if (!oldMap.has(id)) {
        const name =
          newItem.name || newItem.key || newItem.title || `Item ${index + 1}`;
        const displayIndex = opts.arrayZeroBasedIndex?.[key]
          ? index
          : index + 1;
        changes.push(
          `${indent}${prefix} Added ${key.slice(0, -1)}: #${displayIndex} ${name}`,
        );
      }
    });

    // Check for removed items
    oldItems.forEach((oldItem, index) => {
      const id = oldItem[idField] || index;
      if (!newMap.has(id)) {
        const name =
          oldItem.name || oldItem.key || oldItem.title || `Item ${index + 1}`;
        const displayIndex = opts.arrayZeroBasedIndex?.[key]
          ? index
          : index + 1;
        changes.push(
          `${indent}${prefix} Removed ${key.slice(0, -1)}: #${displayIndex} ${name}`,
        );
      }
    });

    // Check for modified items
    newItems.forEach((newItem, index) => {
      const id = newItem[idField] || index;
      const oldItem = oldMap.get(id);
      if (oldItem) {
        const fieldChanges: string[] = [];
        Object.keys(newItem).forEach((field) => {
          if (ignoredFields.includes(field)) return;
          const oldVal = oldItem[field];
          const newVal = newItem[field];
          if (!isEqual(oldVal, newVal)) {
            const formatFieldValue = (val: unknown): string => {
              // Check if there's a custom formatter for this field
              if (opts.fieldFormatters?.[field]) {
                return opts.fieldFormatters[field](val);
              }

              if (val === null || val === undefined) return "`null`";
              if (
                typeof val === "string" ||
                typeof val === "number" ||
                typeof val === "boolean"
              ) {
                return `\`${val}\``;
              }
              if (Array.isArray(val) || typeof val === "object") {
                const json = JSON.stringify(val);
                return `\`${truncate(json, opts.maxJsonLength)}\``;
              }
              return `\`${val}\``;
            };
            fieldChanges.push(
              `${field}: ${formatFieldValue(oldVal)} → ${formatFieldValue(newVal)}`,
            );
          }
        });
        if (fieldChanges.length > 0) {
          const name =
            newItem.name || newItem.key || newItem.title || `Item ${index + 1}`;
          const displayIndex = opts.arrayZeroBasedIndex?.[key]
            ? index
            : index + 1;
          changes.push(
            `${indent}${prefix} Modified ${key.slice(0, -1)} #${displayIndex} ${name}:\n${indent}  ${fieldChanges.join(`\n${indent}  `)}`,
          );
        }
      }
    });

    return changes;
  };

  const getItemLabel = (
    obj: unknown,
    position?: number,
    maxLength?: number,
    fieldName?: string,
  ): string => {
    const effectiveMaxLength = maxLength || Math.min(opts.maxJsonLength, 120);

    // Check if there's a custom formatter for this field
    if (fieldName && opts.fieldFormatters?.[fieldName]) {
      const formatted = opts.fieldFormatters[fieldName](obj);
      return position !== undefined ? `#${position} (${formatted})` : formatted;
    }

    // Handle arrays specially
    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return position !== undefined
          ? `#${position} (empty array)`
          : "empty array";
      }

      // Check if it's an array of primitives
      const isPrimitiveArray =
        typeof obj[0] === "string" ||
        typeof obj[0] === "number" ||
        typeof obj[0] === "boolean";

      if (isPrimitiveArray) {
        const json = JSON.stringify(obj);
        const truncated = `\`${truncate(json, effectiveMaxLength)}\``;
        return position !== undefined
          ? `#${position} (${truncated})`
          : truncated;
      } else {
        // Array of objects - check if it should show count
        const shouldShowCount =
          opts.countArrayFields?.includes("*") ||
          (fieldName && opts.countArrayFields?.includes(fieldName));

        if (shouldShowCount && fieldName) {
          const count = obj.length;
          const itemName =
            opts.arrayItemNames?.[fieldName] || fieldName.slice(0, -1); // Remove 's' from plural
          const result = `${count} ${itemName}${count === 1 ? "" : "s"}`;
          return position !== undefined ? `#${position} (${result})` : result;
        } else {
          // Regular array of objects - show count and first few items
          const preview = obj.slice(0, 2).map((item, _index) => {
            if (typeof item === "object" && item !== null) {
              const keys = Object.keys(item as Record<string, unknown>);
              return `{${keys.join(", ")}}`;
            }
            return String(item);
          });
          const previewStr =
            preview.length > 0 ? preview.join(", ") : "objects";
          const count = obj.length;
          const result = `[${count} items: ${previewStr}${count > 2 ? "..." : ""}]`;
          return position !== undefined ? `#${position} (${result})` : result;
        }
      }
    }

    // If we have multiple fields configured, prefer JSON summary using only specified fields
    if (opts.itemLabelFields.length > 1 && obj && typeof obj === "object") {
      try {
        // Only pick the fields specified in itemLabelFields
        const picked = pick(
          obj as Record<string, unknown>,
          opts.itemLabelFields,
        );
        // Filter out empty fields
        const filtered = Object.fromEntries(
          Object.entries(picked).filter(([_, value]) => !isEmpty(value)),
        );
        const json = JSON.stringify(filtered);
        const truncated = `\`${truncate(json, effectiveMaxLength)}\``;
        return position !== undefined
          ? `#${position} (${truncated})`
          : truncated;
      } catch {
        // Fall through to single field logic
      }
    }

    // Single field or fallback logic
    for (const f of opts.itemLabelFields) {
      const v = tryGet(obj, f);
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        const sv = String(v).trim();
        if (sv) {
          const result = sv;
          return position !== undefined ? `#${position} (${result})` : result;
        }
      }
    }

    // Final fallback - use all fields if no itemLabelFields match
    try {
      if (obj && typeof obj === "object") {
        const filtered = Object.fromEntries(
          Object.entries(obj as Record<string, unknown>).filter(
            ([key, value]) =>
              !isEmpty(value) &&
              !excludedFields.includes(key) &&
              key !== "__index",
          ),
        );
        const json = JSON.stringify(filtered);
        const truncated = `\`${truncate(json, effectiveMaxLength)}\``;
        return position !== undefined
          ? `#${position} (${truncated})`
          : truncated;
      }
      const json = JSON.stringify(obj);
      const truncated = `\`${truncate(json, effectiveMaxLength)}\``;
      return position !== undefined ? `#${position} (${truncated})` : truncated;
    } catch {
      return position !== undefined ? `#${position} (item)` : "item";
    }
  };

  // Added properties
  if (Object.keys(diff.added || []).length > 0) {
    const cleanedAdded = omit(diff.added, excludedFields);
    if (Object.keys(cleanedAdded).length > 0) {
      const propertyLines: string[] = [];

      Object.entries(cleanedAdded).forEach(([key, value]) => {
        // Check if there's a custom field formatter for this key
        if (opts.fieldFormatters?.[key]) {
          const formatted = opts.fieldFormatters[key](value);
          propertyLines.push(`${key}:${formatted}`);
        } else {
          // Default formatting
          propertyLines.push(`${key}: ${getItemLabel(value)}`);
        }
      });

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `⊳ *added properties*\n${propertyLines.join("\n")}`,
        },
      });
    }
  }

  // Removed properties
  if (Object.keys(diff.removed || []).length > 0) {
    const cleanedRemoved = omit(diff.removed, excludedFields);
    if (Object.keys(cleanedRemoved).length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `⊳ *removed properties*\n\`\`\`\n${truncate(JSON.stringify(cleanedRemoved, null, 2), opts.maxJsonLength)}\n\`\`\``,
        },
      });
    }
  }

  // Modified properties - one block per key
  (diff.modified || []).forEach((mod: ModificationItem) => {
    if (isSimpleModification(mod)) {
      if (excludedFields.includes(mod.key)) return;

      // Special handling for arrays (but not nested arrays)
      if (
        Array.isArray(mod.oldValue) &&
        Array.isArray(mod.newValue) &&
        !mod.key.includes("[") &&
        !mod.key.includes(".")
      ) {
        // Check if this is an array of primitives (strings, numbers, etc.)
        const isPrimitiveArray =
          mod.newValue.length > 0 &&
          (typeof mod.newValue[0] === "string" ||
            typeof mod.newValue[0] === "number" ||
            typeof mod.newValue[0] === "boolean");

        if (isPrimitiveArray) {
          // Handle arrays of primitives (like guardrailMetrics, goalMetrics, etc.)
          const changes = formatPrimitiveArrayChanges(
            mod.key,
            mod.oldValue as unknown[],
            mod.newValue as unknown[],
            "",
            "•",
          );

          if (changes.length > 0) {
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${mod.key}*\n${changes.join("\n")}`,
              },
            });
          }
          return;
        } else if (opts.arrayIdFields?.[mod.key]) {
          // Handle arrays of objects (like variations, phases, etc.)
          const oldItems = mod.oldValue as Record<string, unknown>[];
          const newItems = mod.newValue as Record<string, unknown>[];
          const idField = opts.arrayIdFields[mod.key];
          const ignoredFields = opts.arrayIgnoredFields?.[mod.key] || [];

          const changes = formatArrayChanges(
            mod.key,
            oldItems,
            newItems,
            idField,
            "",
            "•",
            ignoredFields,
          );

          if (changes.length > 0) {
            blocks.push({
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${mod.key}*\n${changes.join("\n")}`,
              },
            });
          }
          return;
        }
      }

      // Fallback to regular field change display
      {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${mod.key}*\nold: ${getItemLabel(mod.oldValue)}\nnew: ${getItemLabel(mod.newValue)}`,
          },
        });
      }
    } else if (isHierarchicalModification(mod)) {
      if (excludedFields.includes(mod.key)) return;

      const formatHierarchicalChanges = (
        values: HierarchicalValue[],
      ): string => {
        const sections: string[] = [];

        values.forEach((value) => {
          sections.push(`\t*${value.key}:*`);

          if (value.added && Object.keys(value.added).length > 0) {
            sections.push(`\t⊳ *added:* ${getItemLabel(value.added)}`);
          }

          if (value.removed && Object.keys(value.removed).length > 0) {
            sections.push(`\t⊳ *removed:* ${getItemLabel(value.removed)}`);
          }

          if (value.modified && value.modified.length > 0) {
            value.modified.forEach((change) => {
              if (isSimpleModification(change)) {
                sections.push(
                  `\t⊳ *modified ${change.key}:* ${getItemLabel(change.oldValue)} → ${getItemLabel(change.newValue)}`,
                );
              }
            });
          }

          // Handle array changes (added/removed/modified items)
          if (value.changes) {
            const hasOrderSummaries = !!value.changes.orderSummaries?.length;

            // Use consolidated array formatting if we have array ID fields configured
            if (
              opts.arrayIdFields?.[value.key] &&
              value.changes.added &&
              value.changes.removed &&
              value.changes.modified
            ) {
              const idField = opts.arrayIdFields[value.key];
              const ignoredFields = opts.arrayIgnoredFields?.[value.key] || [];
              const changes = formatArrayChanges(
                value.key,
                value.changes.removed,
                value.changes.added,
                idField,
                "\t  ",
                "•",
                ignoredFields,
              );
              if (changes.length > 0) {
                sections.push(
                  `\t⊳ *${value.key} changes:*\n${changes.join("\n")}`,
                );
              }
            } else {
              // Fallback to original logic for non-configured arrays
              if (value.changes.added?.length) {
                const labels = value.changes.added.map((item) => {
                  const index = (item as Record<string, unknown>)
                    .__index as number;
                  const position =
                    typeof index === "number" ? `#${index + 1}` : "";
                  return `\t  • ${position} (${getItemLabel(item)})`;
                });
                sections.push(
                  `\t⊳ *added ${value.key}:*\n${labels.join("\n")}`,
                );
              }
              if (value.changes.removed?.length) {
                const labels = value.changes.removed.map((item) => {
                  const index = (item as Record<string, unknown>)
                    .__index as number;
                  const position =
                    typeof index === "number" ? `#${index + 1}` : "";
                  return `\t  • ${position} (${getItemLabel(item)})`;
                });
                sections.push(
                  `\t⊳ *removed ${value.key}:*\n${labels.join("\n")}`,
                );
              }
            }
            if (value.changes.orderSummaries?.length) {
              const summaryLines: string[] = [];
              for (const s of value.changes.orderSummaries) {
                if (s.type === "reorderShift") {
                  const fromPos = toOneBased(s.fromIndex);
                  const toPos = toOneBased(s.toIndex);
                  // Try to find the moved item in the modified list to get its data
                  const movedItem = value.changes.modified?.find(
                    (m) => m.id === s.movedId,
                  );
                  const itemData = movedItem?.newValue || movedItem;
                  const summaryLabel = getItemLabel(itemData, fromPos, 100);
                  summaryLines.push(
                    `\t  • moved ${summaryLabel} to #${toPos} (${s.direction}). Shifted ${s.affectedCount} other${s.affectedCount === 1 ? "" : "s"}.`,
                  );
                } else if (s.type === "insertShift") {
                  const atPos = toOneBased(s.insertIndex);
                  summaryLines.push(
                    `\t  • inserted at #${atPos}: shifted ${s.affectedCount} ${s.direction}.`,
                  );
                } else if (s.type === "deleteShift") {
                  const atPos = toOneBased(s.deleteIndex);
                  summaryLines.push(
                    `\t  • deleted at #${atPos}: shifted ${s.affectedCount} ${s.direction}.`,
                  );
                }
              }
              if (summaryLines.length) {
                sections.push(
                  `\t⊳ *reordered ${value.key}:*\n${summaryLines.join("\n")}`,
                );
              }
            }
            if (value.changes.modified?.length) {
              const moveLines: string[] = [];
              const updateLines: string[] = [];
              for (const change of value.changes.modified) {
                const hasIndexMove =
                  typeof change.oldIndex === "number" &&
                  typeof change.newIndex === "number" &&
                  change.oldIndex !== change.newIndex;
                const hasFieldChanges =
                  "fieldChanges" in change && !!change.fieldChanges?.length;

                if (hasIndexMove && !hasFieldChanges) {
                  const fromPos = toOneBased(change.oldIndex);
                  const toPos = toOneBased(change.newIndex);
                  const steps = Math.abs((change.steps as number) || 0);
                  const dir = (change.steps as number) > 0 ? "up" : "down";
                  if (!hasOrderSummaries) {
                    moveLines.push(
                      `\t• ${getItemLabel((change as unknown as { newValue?: unknown }).newValue || change)} moved ${dir} ${steps} to #${toPos} (from #${fromPos})`,
                    );
                  }
                  // Always skip fallback when this is purely a move
                  continue;
                }

                if (hasFieldChanges) {
                  const label = getItemLabel(
                    (change as unknown as { newValue?: unknown }).newValue ||
                      change,
                  );
                  const fieldLines = (
                    change as unknown as { fieldChanges?: ItemFieldChange[] }
                  ).fieldChanges!.map(
                    (fc) =>
                      `\t\t- ${fc.field}: ${getItemLabel(fc.oldValue)} → ${getItemLabel(fc.newValue)}`,
                  );
                  const newValue = (change as unknown as { newValue?: unknown })
                    .newValue;
                  const index =
                    newValue &&
                    typeof newValue === "object" &&
                    "__index" in newValue
                      ? ((newValue as Record<string, unknown>)
                          .__index as number)
                      : change.newIndex;
                  const position =
                    typeof index === "number" ? `#${index + 1} ` : "";
                  updateLines.push(
                    `\t• ${position}${label}\n${fieldLines.join("\n")}`,
                  );
                  continue;
                }

                const newValue = (change as unknown as { newValue?: unknown })
                  .newValue;
                const index =
                  newValue &&
                  typeof newValue === "object" &&
                  "__index" in newValue
                    ? ((newValue as Record<string, unknown>).__index as number)
                    : change.newIndex;
                const position =
                  typeof index === "number" ? `#${index + 1} ` : "";
                updateLines.push(`• ${position} (${getItemLabel(change)})`);
              }
              if (!hasOrderSummaries && moveLines.length)
                sections.push(
                  `\t⊳ *reordered ${value.key}:*\n${moveLines.join("\n")}`,
                );
              if (updateLines.length)
                sections.push(
                  `\t⊳ *updated ${value.key}:*\n${updateLines.join("\n")}`,
                );
            }
            // Reorders are represented within modified entries via oldIndex/newIndex/steps
          }

          // Recurse into nested values
          if (value.values && value.values.length > 0) {
            sections.push(formatHierarchicalChanges(value.values));
          }
        });

        return sections.join("\n");
      };

      const lines: string[] = [];
      // Include top-level added/removed/modified under this hierarchical key
      if (mod.added && Object.keys(mod.added).length > 0) {
        lines.push(`• added: ${getItemLabel(mod.added)}`);
      }
      if (mod.removed && Object.keys(mod.removed).length > 0) {
        lines.push(`• removed: ${getItemLabel(mod.removed)}`);
      }
      if (mod.modified && mod.modified.length > 0) {
        mod.modified.forEach((change: ModificationItem) => {
          if (excludedFields.includes(change.key)) return;
          if (isSimpleModification(change)) {
            // Check if this is an array change within a hierarchical modification
            if (
              Array.isArray(change.oldValue) &&
              Array.isArray(change.newValue)
            ) {
              // Check if this is an array of primitives (strings, numbers, etc.)
              const isPrimitiveArray =
                change.newValue.length > 0 &&
                (typeof change.newValue[0] === "string" ||
                  typeof change.newValue[0] === "number" ||
                  typeof change.newValue[0] === "boolean");

              if (isPrimitiveArray) {
                // Handle arrays of primitives
                const changes = formatPrimitiveArrayChanges(
                  change.key,
                  change.oldValue as unknown[],
                  change.newValue as unknown[],
                  "",
                  "•",
                );
                if (changes.length > 0) {
                  lines.push(...changes);
                }
              } else {
                // Check if this should use count formatting
                const shouldUseCountFormat =
                  opts.countArrayFields?.includes("*") ||
                  opts.countArrayFields?.includes(change.key);

                if (shouldUseCountFormat) {
                  // Handle arrays with count formatting
                  const itemName =
                    opts.arrayItemNames?.[change.key] ||
                    change.key.slice(0, -1); // Remove 's' from plural
                  const countChange = formatCountArrayChange(
                    change.key,
                    change.oldValue as unknown[],
                    change.newValue as unknown[],
                    itemName,
                  );
                  lines.push(`• modified ${change.key}: ${countChange}`);
                } else {
                  // Handle arrays of objects or fallback to regular display
                  lines.push(
                    `• modified ${change.key}: ${getItemLabel(change.oldValue, undefined, undefined, change.key)} → ${getItemLabel(change.newValue, undefined, undefined, change.key)}`,
                  );
                }
              }
            } else {
              // Regular field change
              lines.push(
                `• modified ${change.key}: ${getItemLabel(change.oldValue, undefined, undefined, change.key)} → ${getItemLabel(change.newValue, undefined, undefined, change.key)}`,
              );
            }
          }
        });
      }
      if (mod.values && mod.values.length > 0) {
        const nested = formatHierarchicalChanges(mod.values);
        if (nested) lines.push(nested);
      }

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${mod.key}*\n${lines.join("\n")}`,
        },
      });
    }
  });

  return {
    text: "Changes detected",
    blocks,
  };
}

// endregion Slack diff formatter
