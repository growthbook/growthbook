import { KnownBlock } from "@slack/types";
import formatNumber from "number-format.js";
import omit from "lodash/omit";
import pick from "lodash/pick";
import isEqual from "lodash/isEqual";
import { daysBetween } from "shared/dates";
import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "shared/types/events/notification-events";
import { EventInterface } from "shared/types/events/event";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { SlackIntegrationInterface } from "shared/types/slack-integration";
import {
  ExperimentWarningNotificationPayload,
  ExperimentInfoSignificancePayload,
  ExperimentDecisionNotificationPayload,
  ExperimentStartedNotificationPayload,
  ExperimentStoppedNotificationPayload,
  ExperimentGuardrailFailedNotificationPayload,
  ExperimentNoDataNotificationPayload,
  ExperimentQueryFailedNotificationPayload,
  ExperimentStatusChangedNotificationPayload,
  ExperimentEndingSoonNotificationPayload,
  ExperimentStaleNotificationPayload,
  ExperimentMetricRegressionNotificationPayload,
  ExperimentBanditChangedNotificationPayload,
  ExperimentHoldoutNotificationPayload,
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
import { getExperimentByIdForOrganization } from "back-end/src/models/ExperimentModel";
import { getSlackBotAccessTokenForWebhook } from "back-end/src/models/EventWebhookModel";
import { getUserById } from "back-end/src/models/UserModel";
import { cancellableFetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { buildExperimentCardData } from "back-end/src/services/slack/experimentCardData";
import { renderExperimentCard } from "back-end/src/services/slack/cards";
import type { CompactEvent } from "back-end/src/services/slack/chartImage";

// region Filtering

export type DataForNotificationEvent = {
  filterData: FilterDataForNotificationEvent;
  slackMessage: SlackMessage;
};

export type SlackMessageRenderContext = {
  eventUser?: string;
  organizationId?: string;
  event?: NotificationEvent;
  experimentDetails?: ExperimentDetailsSource;
};

export const getSlackMessageForNotificationEvent = async (
  event: NotificationEvent,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage | null> => {
  let invalidEvent: never;

  switch (event.event) {
    case "user.login":
      return null;

    case "feature.created":
      return buildSlackMessageForFeatureCreatedEvent(
        event.data.object.id,
        eventId,
        renderContext,
      );

    case "feature.updated":
      return buildSlackMessageForFeatureUpdatedEvent(
        event.data.object.id,
        eventId,
        renderContext,
      );

    case "feature.deleted":
      return buildSlackMessageForFeatureDeletedEvent(
        event.data.object.id,
        eventId,
        renderContext,
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

    case "feature.stale.candidate":
      return buildSlackMessageForFeatureStaleCandidateEvent(
        event.data.object,
        eventId,
      );

    case "experiment.created":
      return await buildSlackMessageForExperimentCreatedEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.updated":
      return await buildSlackMessageForExperimentUpdatedEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.warning":
      return await buildSlackMessageForExperimentWarningEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.info.significance":
      return await buildSlackMessageForExperimentInfoSignificanceEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.deleted":
      return await buildSlackMessageForExperimentDeletedEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.decision.ship":
      return await buildSlackMessageForExperimentShipEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.decision.rollback":
      return await buildSlackMessageForExperimentRollbackEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.decision.review":
      return await buildSlackMessageForExperimentReviewEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.started":
      return await buildSlackMessageForExperimentStartedEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.stopped.shipped":
    case "experiment.stopped.rolledback":
      return await buildSlackMessageForExperimentStoppedEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.health.guardrailFailed":
      return await buildSlackMessageForExperimentGuardrailFailedEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.health.noData":
      return await buildSlackMessageForExperimentNoDataEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.health.queryFailed":
      return await buildSlackMessageForExperimentQueryFailedEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.status.changed":
      return await buildSlackMessageForExperimentStatusChangedEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.endingSoon":
      return await buildSlackMessageForExperimentEndingSoonEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.stale":
      return await buildSlackMessageForExperimentStaleEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.metric.regression":
      return await buildSlackMessageForExperimentMetricRegressionEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.bandit.weightsChanged":
      return await buildSlackMessageForExperimentBanditChangedEvent(
        event.data.object,
        eventId,
        renderContext,
      );

    case "experiment.holdout.created":
    case "experiment.holdout.updated":
      return await buildSlackMessageForExperimentHoldoutEvent(
        event.data.object,
        eventId,
        renderContext,
      );

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

// Map a notification event to the compact card's *event* (which drives its hero
// layout). Returns undefined when it doesn't map cleanly; the card then derives
// one from the experiment's state. The set of card events here mirrors
// SLACK_CARD_EVENT_KINDS in shared (used by the settings UI to badge card vs
// text) — keep the two in sync.
const compactEventForNotification = (
  event: NotificationEvent,
): CompactEvent | undefined => {
  switch (event.event) {
    case "experiment.started":
      return "started";
    case "experiment.info.significance":
      return "significance";
    // Decision Framework recommendations — the experiment is still running, so
    // these are "ship/rollback recommended", not the stopped "won"/"lost"
    // outcome (that's experiment.stopped.*).
    case "experiment.decision.ship":
      return "decisionShip";
    case "experiment.decision.rollback":
      return "decisionRollback";
    case "experiment.warning":
    case "experiment.health.guardrailFailed":
    case "experiment.health.noData":
    case "experiment.health.queryFailed":
      return "warning";
    // A stop is emitted as shipped/rolledback, but the real outcome is in
    // `results`: a non-ship stop can be inconclusive/dnf, i.e. a neutral
    // "stopped" rather than a "rolled back / no lift" loss.
    case "experiment.stopped.shipped":
    case "experiment.stopped.rolledback": {
      const results = (event.data?.object as { results?: string } | undefined)
        ?.results;
      if (results === "won") return "won";
      if (results === "lost") return "lost";
      return "stopped";
    }
    default:
      return undefined;
  }
};

// Short, URL-free card caption. Omits the experiment name (which can contain a
// URL that Slack would unfurl); the card image already shows the name.
const CARD_CAPTION: Record<CompactEvent, string> = {
  started: "Experiment started",
  significance: "Reached significance",
  won: "Declared a winner",
  lost: "Rolled back",
  stopped: "Experiment stopped",
  warning: "Health alert",
  decisionShip: "Ship recommended",
  decisionRollback: "Rollback recommended",
};

// Render the compact results-card PNG for an experiment event (best-effort).
// Only card-worthy lifecycle events get one (not metadata changes like
// experiment.updated); returns the PNG plus a URL-free caption. Never throws.
export const renderExperimentCardForEvent = async (
  event: NotificationEvent,
  organizationId: string,
  format: "none" | "compact" | "detailed" = "compact",
): Promise<{
  png: Buffer;
  altText: string;
  caption: string;
  experimentId: string;
} | null> => {
  if (format === "none") return null;
  const compactEvent = compactEventForNotification(event);
  if (!compactEvent) return null; // not a card-worthy event

  const object = event.data?.object as
    | { id?: string; experimentId?: string }
    | undefined;
  const experimentId = object?.id || object?.experimentId;
  if (!experimentId) return null;

  try {
    const context = await getContextForAgendaJobByOrgId(organizationId);
    const card = await buildExperimentCardData(context, experimentId);
    if (!card) return null;
    card.event = compactEvent;
    const png = await renderExperimentCard(
      card,
      format === "detailed" ? "detailed" : "compact",
    );
    return {
      png,
      altText: `${card.name} — experiment results`,
      caption: CARD_CAPTION[compactEvent],
      experimentId,
    };
  } catch (e) {
    logger.warn(
      e,
      `Slack notification: failed to render experiment card for ${experimentId}`,
    );
    return null;
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
      return buildSlackMessageForExperimentWarningEvent(event.data, eventId);

    case "experiment.deleted":
      return await buildSlackMessageForExperimentDeletedEvent(
        event.data.previous,
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

// Standalone "View ..." footer links make Slack messages noisy. Prefer
// inline links in the message body when a resource link is useful.
const suppressStandaloneLink = (value: string): string => value.slice(0, 0);

export const getFeatureUrlFormatted = (featureId: string): string =>
  suppressStandaloneLink(featureId);

export const getEventUrlFormatted = (eventId: string): string =>
  suppressStandaloneLink(eventId);

export const getEventUserFormatted = async (
  eventId: string,
  renderContext?: SlackMessageRenderContext,
) => {
  if (renderContext?.eventUser) return renderContext.eventUser;

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
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId, renderContext);

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
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId, renderContext);
  const event =
    renderContext?.event ||
    ((await getEvent(eventId))?.data as NotificationEvent | undefined);

  let changeBlocks: KnownBlock[] = [];

  // Check if we have changes (diff) to format
  if (event?.data && "changes" in event.data) {
    const formattedDiff = formatDiffForSlack(event.data.changes as DiffResult, {
      itemLabelFields: [
        "type",
        "value",
        "coverage",
        "condition",
        "savedGroupTargeting",
        "prerequisites",
      ],
    });
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
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId, renderContext);
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

const buildSlackMessageForFeatureStaleCandidateEvent = (
  data: {
    featureId: string;
    featureName?: string;
    daysSinceLastUpdate?: number;
    reason: string;
  },
  eventId: string,
): SlackMessage => {
  const featureLabel = data.featureName || data.featureId;
  const ageText =
    typeof data.daysSinceLastUpdate === "number"
      ? ` It has not been updated for ${data.daysSinceLastUpdate} days.`
      : "";
  const text = `Feature ${featureLabel} may be ready for cleanup. ${data.reason}${ageText}`;

  return {
    text,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Feature may be stale",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `Feature *${featureLabel}* may be ready for cleanup.\n${data.reason}${ageText}` +
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
  suppressStandaloneLink(experimentId);

const getExperimentUrl = (experimentId: string, hash?: string): string =>
  `${APP_ORIGIN}/experiment/${experimentId}${hash ? `#${hash}` : ""}`;

// A Slack-mrkdwn click-through link ("<url|label>"). Used as the initial
// comment on uploaded card/digest images, which are otherwise just a picture
// with no way to open the experiment in GrowthBook.
export const growthbookViewLink = (
  path: string,
  label = "View in GrowthBook",
): string => `<${APP_ORIGIN}${path}|${label}>`;

export const getExperimentViewLink = (experimentId: string): string =>
  growthbookViewLink(`/experiment/${experimentId}`);

export const getExperimentUrlAndNameFormatted = (
  experimentId: string,
  experimentName: string,
): string => `<${getExperimentUrl(experimentId)}|${experimentName}>`;

const getExperimentActionBlock = (
  experimentId: string,
  actions: { text: string; hash?: string; actionId: string; value?: string }[],
): KnownBlock => ({
  type: "actions",
  elements: actions.map(({ text, hash, actionId, value }) => ({
    type: "button",
    text: {
      type: "plain_text",
      text,
    },
    action_id: actionId,
    ...(hash !== undefined
      ? { url: getExperimentUrl(experimentId, hash) }
      : {}),
    ...(value ? { value } : {}),
  })),
});

const getExperimentResultsActionBlock = (experimentId: string): KnownBlock =>
  getExperimentActionBlock(experimentId, [
    {
      text: "Open Results",
      hash: "results",
      actionId: "growthbook_open_results",
    },
    {
      text: "Snooze 24h",
      actionId: "growthbook_snooze_experiment_24h",
      value: experimentId,
    },
  ]);

const getExperimentDiagnosticsActionBlock = (
  experimentId: string,
): KnownBlock =>
  getExperimentActionBlock(experimentId, [
    {
      text: "Open Results",
      hash: "results",
      actionId: "growthbook_open_results",
    },
    {
      text: "Open Experiment",
      hash: "",
      actionId: "growthbook_open_experiment",
    },
    {
      text: "Snooze 24h",
      actionId: "growthbook_snooze_experiment_24h",
      value: experimentId,
    },
  ]);

type ExperimentDetailsSource = {
  id?: string;
  experimentId?: string;
  trackingKey?: string;
  name?: string;
  experimentName?: string;
  owner?: string;
  ownerEmail?: string;
  phases?: {
    dateStarted?: string | Date;
    dateEnded?: string | Date;
  }[];
  analysisSummary?: {
    health?: {
      totalUsers?: number | null;
    };
  };
};

const formatCompactNumber = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const getSafeDate = (date: string | Date | undefined): Date | null => {
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getExperimentDurationText = (
  experiment: ExperimentDetailsSource,
): string => {
  const firstPhase = experiment.phases?.[0];
  const lastPhase = experiment.phases?.[experiment.phases.length - 1];
  const startDate = getSafeDate(firstPhase?.dateStarted);
  if (!startDate) return "No duration yet";

  const endDate = getSafeDate(lastPhase?.dateEnded) || new Date();
  const days = Math.max(0, daysBetween(startDate, endDate));
  return `${days} ${days === 1 ? "day" : "days"}`;
};

const getExperimentUsersText = (
  experiment: ExperimentDetailsSource,
): string => {
  const totalUsers = experiment.analysisSummary?.health?.totalUsers;
  if (typeof totalUsers !== "number") return "No users yet";
  return `${formatCompactNumber(totalUsers)} users`;
};

const getOwnerText = async (
  experiment: ExperimentDetailsSource,
): Promise<string> => {
  const owner = experiment.owner;
  const ownerEmail = experiment.ownerEmail;

  if (!owner && !ownerEmail) return "Owner: Unassigned";

  if (owner?.startsWith("u_")) {
    const user = await getUserById(owner);
    return `Owner: ${user?.email || ownerEmail || "Unknown user"}`;
  }

  return `Owner: ${ownerEmail || owner}`;
};

const getExperimentDetailsSource = async (
  eventId: string,
  source: ExperimentDetailsSource,
  renderContext?: SlackMessageRenderContext,
): Promise<ExperimentDetailsSource> => {
  if (renderContext?.experimentDetails) {
    return {
      ...renderContext.experimentDetails,
      ...source,
    };
  }

  const experimentId = source.id || source.experimentId;
  if (!experimentId) return source;

  const event = await getEvent(eventId);
  const organizationId = event?.organizationId || renderContext?.organizationId;
  if (!organizationId) return source;

  try {
    return (
      (await getExperimentByIdForOrganization(organizationId, experimentId)) ||
      source
    );
  } catch (e) {
    logger.error(e, "Failed to load experiment details for Slack message");
    return source;
  }
};

const getExperimentDetailsBlock = async (
  eventId: string,
  source: ExperimentDetailsSource,
  renderContext?: SlackMessageRenderContext,
): Promise<KnownBlock | null> => {
  const experiment = await getExperimentDetailsSource(
    eventId,
    source,
    renderContext,
  );
  const label =
    experiment.trackingKey ||
    experiment.name ||
    experiment.experimentName ||
    experiment.id ||
    experiment.experimentId;

  if (!label) return null;

  return {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: [
          label,
          getExperimentDurationText(experiment),
          getExperimentUsersText(experiment),
          await getOwnerText(experiment),
        ].join(" | "),
      },
    ],
  };
};

const withExperimentDetailsBlock = async (
  slackMessage: SlackMessage,
  eventId: string,
  source: ExperimentDetailsSource,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const detailsBlock = await getExperimentDetailsBlock(
    eventId,
    source,
    renderContext,
  );
  if (!detailsBlock) return slackMessage;

  return {
    ...slackMessage,
    blocks: [...slackMessage.blocks, detailsBlock],
  };
};

const getExperimentWarningTitleBlock = (
  experimentId: string,
  experimentName: string,
  label: string,
): KnownBlock => ({
  type: "section",
  text: {
    type: "mrkdwn",
    text: `⚠️ ${getExperimentUrlAndNameFormatted(
      experimentId,
      experimentName,
    )} · ${label}`,
  },
});

const buildSlackMessageForExperimentCreatedEvent = async (
  experiment: ExperimentDetailsSource & { id: string; name: string },
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const { id: experimentId, name: experimentName } = experiment;
  const eventUser = await getEventUserFormatted(eventId, renderContext);
  const isUnknownUser = eventUser === "an unknown user";
  const text = `The experiment ${experimentName} has been created ${isUnknownUser ? "automatically" : `by ${eventUser}`}`;

  return withExperimentDetailsBlock(
    {
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
    },
    eventId,
    experiment,
    renderContext,
  );
};

const buildSlackMessageForExperimentUpdatedEvent = async (
  experiment: ExperimentDetailsSource & { id: string; name: string },
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const { id: experimentId, name: experimentName } = experiment;
  const eventUser = await getEventUserFormatted(eventId, renderContext);
  const event =
    renderContext?.event ||
    ((await getEvent(eventId))?.data as NotificationEvent | undefined);

  let changeBlocks: KnownBlock[] = [];

  // Check if we have changes (diff) to format
  if (event?.data && "changes" in event.data) {
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
    const formattedDiff = formatDiffForSlack(event.data.changes as DiffResult, {
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
            const eventData = event?.data as Record<string, unknown>;
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
                variationIndex >= 0 ? variationIndex : obj.releasedVariationId;
              lines.push(`- releasedVariationId: \`${displayIndex}\``);
            }

            if (obj.excludeFromPayload !== undefined) {
              lines.push(`- excludeFromPayload: \`${obj.excludeFromPayload}\``);
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
            const eventData = event?.data as Record<string, unknown>;
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
            const eventData = event?.data as Record<string, unknown>;
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
    });
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

  return withExperimentDetailsBlock(
    {
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
    },
    eventId,
    experiment,
    renderContext,
  );
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
  experiment: ExperimentDetailsSource & { id: string; name: string },
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const { name: experimentName } = experiment;
  const eventUser = await getEventUserFormatted(eventId, renderContext);
  const isUnknownUser = eventUser === "an unknown user";
  const text = `The experiment ${experimentName} has been deleted ${isUnknownUser ? "automatically" : `by ${eventUser}`}`;

  return withExperimentDetailsBlock(
    {
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
    },
    eventId,
    experiment,
    renderContext,
  );
};

const buildSlackMessageForExperimentInfoSignificanceEvent = (
  {
    metricName,
    experimentName,
    experimentId,
    variationName,
    statsEngine,
    criticalValue,
    winning,
    uplift,
    ci,
    metricRole,
  }: ExperimentInfoSignificancePayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const percentFormatter = (v: number) => {
    if (v > 0.99) {
      return ">99%";
    }
    if (v < 0.01) {
      return "<1%";
    }
    return formatNumber("#0.%", v * 100);
  };
  const signedPercentFormatter = (v: number) =>
    `${v > 0 ? "+" : ""}${formatNumber("#0.%", v * 100)}`;

  const liftText =
    typeof uplift === "number" ? ` by ${signedPercentFormatter(uplift)}` : "";
  const ciText =
    ci && ci.length === 2
      ? `, CI ${signedPercentFormatter(ci[0])} to ${signedPercentFormatter(
          ci[1],
        )}`
      : "";
  const roleText = metricRole ? `${metricRole} metric ` : "";

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
      return `${variationName} ${winning ? "improved" : "degraded"} ${roleText}${metricName}${liftText}${ciText} in ${experimentName} and is statistically significant (p-value = ${criticalValue.toFixed(
        3,
      )}).`;
    }
    return `${variationName} ${
      winning ? "is likely improving" : "is likely degrading"
    } ${roleText}${metricName}${liftText}${ciText} in ${experimentName} (${percentFormatter(
      criticalValue,
    )} chance to beat baseline).`;
  };

  return withExperimentDetailsBlock(
    {
      text: text({ metricName, experimentName, variationName }),
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: winning
              ? "Statistical significance reached"
              : "Statistical significance reached: metric degraded",
          },
        },
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
        getExperimentResultsActionBlock(experimentId),
      ],
    },
    eventId,
    { experimentId, experimentName },
    renderContext,
  );
};

const buildSlackMessageForExperimentWarningEvent = async (
  data: ExperimentWarningNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  let invalidData: never;

  switch (data.type) {
    case "auto-update": {
      const makeText = (name: string) =>
        `Automatic snapshot creation for ${name} ${
          data.success ? "succeeded" : "failed"
        }!`;

      return withExperimentDetailsBlock(
        {
          text: makeText(data.experimentName),
          blocks: [
            getExperimentWarningTitleBlock(
              data.experimentId,
              data.experimentName,
              data.success ? "Auto-update restored" : "Auto-update failed",
            ),
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
        },
        eventId,
        data,
        renderContext,
      );
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

      return withExperimentDetailsBlock(
        {
          text: text(data.experimentName),
          blocks: [
            getExperimentWarningTitleBlock(
              data.experimentId,
              data.experimentName,
              "Multiple exposures",
            ),
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
        },
        eventId,
        data,
        renderContext,
      );
    }

    case "srm": {
      const text = (experimentName: string) =>
        `Traffic imbalance detected for experiment ${experimentName}: Sample Ratio Mismatch (SRM) p-value is below ${data.threshold}. Check assignment traffic before trusting the results.`;

      return withExperimentDetailsBlock(
        {
          text: text(data.experimentName),
          blocks: [
            getExperimentWarningTitleBlock(
              data.experimentId,
              data.experimentName,
              "SRM",
            ),
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
        },
        eventId,
        data,
        renderContext,
      );
    }

    case "no-data": {
      const text = (experimentName: string) =>
        `No data yet for experiment ${experimentName}. The most recent update ran successfully but returned no results. Make sure your experiment is tracking properly.`;

      return withExperimentDetailsBlock(
        {
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
        },
        eventId,
        data,
        renderContext,
      );
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

      return withExperimentDetailsBlock(
        {
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
        },
        eventId,
        data,
        renderContext,
      );
    }

    default:
      invalidData = data;
      throw `Invalid data: ${invalidData}`;
  }
};

const buildSlackMessageForExperimentShipEvent = (
  data: ExperimentDecisionNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const text = (experimentName: string, description?: string) =>
    `Decision Framework recommends shipping a variation for ${experimentName}.${description ? ` ${description}` : ""}`;
  return withExperimentDetailsBlock(
    {
      text: text(data.experimentName, data.decisionDescription),
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Decision recommended: ship",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              text(`*${data.experimentName}*`, data.decisionDescription) +
              getExperimentUrlFormatted(data.experimentId),
          },
        },
        getExperimentResultsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentRollbackEvent = (
  data: ExperimentDecisionNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const text = (experimentName: string, description?: string) =>
    `Decision Framework recommends rolling back ${experimentName}.${description ? ` ${description}` : ""}`;
  return withExperimentDetailsBlock(
    {
      text: text(data.experimentName, data.decisionDescription),
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Decision recommended: roll back",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              text(`*${data.experimentName}*`, data.decisionDescription) +
              getExperimentUrlFormatted(data.experimentId),
          },
        },
        getExperimentResultsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentReviewEvent = (
  data: ExperimentDecisionNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const text = (experimentName: string, description?: string) =>
    `Decision Framework says ${experimentName} is ready for review.${description ? ` ${description}` : ""}`;
  return withExperimentDetailsBlock(
    {
      text: text(data.experimentName, data.decisionDescription),
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Decision needed: review results",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              text(`*${data.experimentName}*`, data.decisionDescription) +
              getExperimentUrlFormatted(data.experimentId),
          },
        },
        getExperimentResultsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentStartedEvent = async (
  data: ExperimentStartedNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId, renderContext);
  const isUnknownUser = eventUser === "an unknown user";
  const phaseText = data.phaseName ? `\n*Phase:* ${data.phaseName}` : "";
  const text = `Experiment ${data.experimentName} has started running.`;

  return withExperimentDetailsBlock(
    {
      text,
      blocks: [
        getExperimentWarningTitleBlock(
          data.experimentId,
          data.experimentName,
          "Started",
        ),
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `${getExperimentUrlAndNameFormatted(
                data.experimentId,
                data.experimentName,
              )} started running ${
                isUnknownUser
                  ? "automatically"
                  : `after ${eventUser} started it`
              }.${phaseText}\n*Variations:* ${data.variationCount}` +
              getEventUrlFormatted(eventId),
          },
        },
        getExperimentResultsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentStoppedEvent = async (
  data: ExperimentStoppedNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId, renderContext);
  const isUnknownUser = eventUser === "an unknown user";
  const action =
    data.type === "shipped"
      ? "stopped and shipped a variation"
      : "stopped and rolled back";
  const resultLabel = (() => {
    switch (data.results) {
      case "won":
        return "Winning variation";
      case "lost":
        return "Losing variation";
      case "dnf":
        return "Did not finish";
      case "inconclusive":
        return "No clear winner";
    }
  })();
  const rolloutText = data.enableTemporaryRollout
    ? "\nA temporary rollout is enabled."
    : "";
  const variationText = data.releasedVariationName
    ? `\n*Released variation:* ${data.releasedVariationName}`
    : "";
  const reasonText = data.reason ? `\n*Reason:* ${data.reason}` : "";
  const text = `Experiment ${data.experimentName} ${action}.`;

  return withExperimentDetailsBlock(
    {
      text,
      blocks: [
        getExperimentWarningTitleBlock(
          data.experimentId,
          data.experimentName,
          data.type === "shipped" ? "Shipped" : "Rolled back",
        ),
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `${getExperimentUrlAndNameFormatted(
                data.experimentId,
                data.experimentName,
              )} ${action} ${
                isUnknownUser ? "automatically" : `by ${eventUser}`
              }.\n*Result:* ${resultLabel}${variationText}${rolloutText}${reasonText}` +
              getEventUrlFormatted(eventId),
          },
        },
        getExperimentResultsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentGuardrailFailedEvent = (
  data: ExperimentGuardrailFailedNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const metricLines = data.failedMetrics
    .slice(0, 5)
    .map((metric) => `• *${metric.name}* on ${metric.variationName}`)
    .join("\n");
  const overflowText =
    data.failedMetrics.length > 5
      ? `\n• ${data.failedMetrics.length - 5} more guardrails`
      : "";
  const text = `Guardrail failure detected for experiment ${data.experimentName}.`;

  return withExperimentDetailsBlock(
    {
      text,
      blocks: [
        getExperimentWarningTitleBlock(
          data.experimentId,
          data.experimentName,
          "Guardrail failed",
        ),
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `Guardrail failure detected for experiment ${getExperimentUrlAndNameFormatted(
                data.experimentId,
                data.experimentName,
              )}. Investigate before continuing rollout.\n${metricLines}${overflowText}` +
              getExperimentUrlFormatted(data.experimentId),
          },
        },
        getExperimentDiagnosticsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentNoDataEvent = (
  data: ExperimentNoDataNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const text = `Experiment ${data.experimentName} results updated with no data.`;

  return withExperimentDetailsBlock(
    {
      text,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "No experiment data returned",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `Experiment ${getExperimentUrlAndNameFormatted(
                data.experimentId,
                data.experimentName,
              )} results updated successfully, but no data was returned.\n• Check exposure tracking\n• Check metric configuration\n• Check the datasource query setup` +
              getExperimentUrlFormatted(data.experimentId),
          },
        },
        getExperimentDiagnosticsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentQueryFailedEvent = (
  data: ExperimentQueryFailedNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const trimmedError = data.errorMessage
    ? data.errorMessage.slice(0, 500)
    : undefined;
  const errorText = trimmedError ? `\n\`\`\`${trimmedError}\`\`\`` : "";
  const text = `Experiment ${data.experimentName} results update failed.`;

  return withExperimentDetailsBlock(
    {
      text,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Experiment results update failed",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `Experiment ${getExperimentUrlAndNameFormatted(
                data.experimentId,
                data.experimentName,
              )} results failed to update because of a query error. Investigate the datasource query before the next refresh.${errorText}` +
              getExperimentUrlFormatted(data.experimentId),
          },
        },
        getExperimentDiagnosticsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentStatusChangedEvent = (
  data: ExperimentStatusChangedNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const text = `Experiment ${data.experimentName} changed status from ${data.previousStatus} to ${data.currentStatus}.`;

  return withExperimentDetailsBlock(
    {
      text,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `${getExperimentUrlAndNameFormatted(
                data.experimentId,
                data.experimentName,
              )} changed status from *${data.previousStatus}* to *${data.currentStatus}*.` +
              getEventUrlFormatted(eventId),
          },
        },
        getExperimentResultsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentEndingSoonEvent = (
  data: ExperimentEndingSoonNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const text = `Experiment ${data.experimentName} is scheduled to end in ${data.daysRemaining} days.`;

  return withExperimentDetailsBlock(
    {
      text,
      blocks: [
        getExperimentWarningTitleBlock(
          data.experimentId,
          data.experimentName,
          "Ending soon",
        ),
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `${getExperimentUrlAndNameFormatted(
                data.experimentId,
                data.experimentName,
              )} is scheduled to end in *${data.daysRemaining} days* (${data.endsAt}). Review results and prepare a launch, rollback, or extension decision.` +
              getEventUrlFormatted(eventId),
          },
        },
        getExperimentResultsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentStaleEvent = (
  data: ExperimentStaleNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const text = `Experiment ${data.experimentName} may be stale after ${data.daysRunning} days running.`;

  return withExperimentDetailsBlock(
    {
      text,
      blocks: [
        getExperimentWarningTitleBlock(
          data.experimentId,
          data.experimentName,
          "Stale experiment",
        ),
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `${getExperimentUrlAndNameFormatted(
                data.experimentId,
                data.experimentName,
              )} has been running for *${data.daysRunning} days*.\n${data.reason}` +
              getEventUrlFormatted(eventId),
          },
        },
        getExperimentResultsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentMetricRegressionEvent = (
  data: ExperimentMetricRegressionNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const signedPercentFormatter = (v: number) =>
    `${v > 0 ? "+" : ""}${formatNumber("#0.%", v * 100)}`;
  const liftText =
    typeof data.uplift === "number"
      ? ` by ${signedPercentFormatter(data.uplift)}`
      : "";
  const ciText = data.ci
    ? `, CI ${signedPercentFormatter(data.ci[0])} to ${signedPercentFormatter(
        data.ci[1],
      )}`
    : "";
  const roleText = data.metricRole ? `${data.metricRole} metric ` : "";
  const text = `Metric regression detected in experiment ${data.experimentName}: ${data.variationName} degraded ${data.metricName}${liftText}.`;

  return withExperimentDetailsBlock(
    {
      text,
      blocks: [
        getExperimentWarningTitleBlock(
          data.experimentId,
          data.experimentName,
          "Metric regression",
        ),
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `*${data.variationName}* degraded ${roleText}*${data.metricName}*${liftText}${ciText}. Investigate before continuing rollout.` +
              getEventUrlFormatted(eventId),
          },
        },
        getExperimentDiagnosticsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentBanditChangedEvent = (
  data: ExperimentBanditChangedNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const formatWeights = (weights: number[]) =>
    weights.map((w) => formatNumber("#0.%", w * 100)).join(" / ");
  const text = `Bandit weights changed for experiment ${data.experimentName}.`;

  return withExperimentDetailsBlock(
    {
      text,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `Bandit weights changed for ${getExperimentUrlAndNameFormatted(
                data.experimentId,
                data.experimentName,
              )}.\n*Previous:* ${formatWeights(
                data.currentWeights,
              )}\n*New:* ${formatWeights(data.updatedWeights)}` +
              getEventUrlFormatted(eventId),
          },
        },
        getExperimentResultsActionBlock(data.experimentId),
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

const buildSlackMessageForExperimentHoldoutEvent = (
  data: ExperimentHoldoutNotificationPayload,
  eventId: string,
  renderContext?: SlackMessageRenderContext,
): Promise<SlackMessage> => {
  const action = data.type === "holdout-created" ? "created" : "updated";
  const text = `Holdout ${data.experimentName} was ${action}.`;

  return withExperimentDetailsBlock(
    {
      text,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `Holdout ${getExperimentUrlAndNameFormatted(
                data.experimentId,
                data.experimentName,
              )} was *${action}*.` + getEventUrlFormatted(eventId),
          },
        },
      ],
    },
    eventId,
    data,
    renderContext,
  );
};

// endregion Event-specific messages -> Experiment

// endregion Event-specific messages

export type SlackMessage = {
  text: string;
  blocks: KnownBlock[];
};

// region Coalesced (digest) messages

const COALESCED_MAX_EVENTS = 5;

const truncatePlain = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const getObjectLabelForEvent = (event: EventInterface): string => {
  const data = event.data as NotificationEvent | LegacyNotificationEvent;
  const obj = (() => {
    if (!data) return undefined;
    if ("data" in data && data.data && typeof data.data === "object") {
      const inner = data.data as { object?: unknown; current?: unknown };
      return inner.object ?? inner.current;
    }
    return undefined;
  })();

  if (obj && typeof obj === "object") {
    const named = obj as { name?: unknown; id?: unknown };
    if (typeof named.name === "string" && named.name.trim().length > 0) {
      return named.name;
    }
    if (typeof named.id === "string") return named.id;
  }
  return event.objectId ?? event.object ?? "this object";
};

/**
 * Combine an ordered list of already-rendered per-event Slack messages into one
 * digest. Extracted from buildCoalescedSlackMessage so it can be unit tested
 * without the per-event renderers (which do their own DB lookups).
 */
export const composeCoalescedSlackMessage = (
  rendered: Array<{ event: EventInterface; message: SlackMessage }>,
): SlackMessage | null => {
  if (rendered.length === 0) return null;
  if (rendered.length === 1) return rendered[0].message;

  const objectLabel = getObjectLabelForEvent(rendered[0].event);
  const headerText = `*${rendered.length} updates on ${objectLabel}*`;

  const blocks: KnownBlock[] = [
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: headerText,
        },
      ],
    },
  ];

  const visible = rendered.slice(0, COALESCED_MAX_EVENTS);
  visible.forEach(({ message }, index) => {
    if (index > 0) blocks.push({ type: "divider" });
    blocks.push(...message.blocks);
  });

  const hiddenCount = rendered.length - visible.length;
  if (hiddenCount > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_+${hiddenCount} more change${hiddenCount === 1 ? "" : "s"} not shown_`,
        },
      ],
    });
  }

  const text = `${rendered.length} updates on ${objectLabel}: ${truncatePlain(
    rendered
      .map(({ message }) => message.text)
      .filter(Boolean)
      .join(" • "),
    500,
  )}`;

  return { text, blocks };
};

/**
 * Build one digest message from multiple events on the same object within the
 * coalescing window. Events that render to `null` (unsupported types) are
 * skipped; a lone remaining event is returned as-is so coalescing is invisible
 * for non-bursty objects.
 */
export const buildCoalescedSlackMessage = async (
  events: EventInterface[],
): Promise<SlackMessage | null> => {
  if (events.length === 0) return null;

  const rendered: Array<{ event: EventInterface; message: SlackMessage }> = [];
  for (const event of events) {
    try {
      const message = await (event.version
        ? getSlackMessageForNotificationEvent(
            event.data as NotificationEvent,
            event.id,
          )
        : getSlackMessageForLegacyNotificationEvent(
            event.data as LegacyNotificationEvent,
            event.id,
          ));
      if (message) rendered.push({ event, message });
    } catch (e) {
      logger.error(
        e,
        `buildCoalescedSlackMessage: failed to render event ${event.id}`,
      );
    }
  }

  return composeCoalescedSlackMessage(rendered);
};

// endregion Coalesced (digest) messages

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

const SLACK_API_URL = "https://slack.com/api";
const DIRECT_MESSAGE_EVENT_NAMES = new Set<string>([
  "experiment.decision.ship",
  "experiment.decision.rollback",
  "experiment.decision.review",
  "experiment.endingSoon",
  "experiment.health.guardrailFailed",
  "experiment.health.noData",
  "experiment.health.queryFailed",
  "experiment.metric.regression",
]);

const getExperimentIdFromEvent = (event: EventInterface): string | null => {
  if (event.object === "experiment" && event.objectId) return event.objectId;
  const data = event.data as NotificationEvent | undefined;
  const object = data?.data?.object;
  if (object && typeof object === "object" && "experimentId" in object) {
    const experimentId = (object as { experimentId?: unknown }).experimentId;
    return typeof experimentId === "string" ? experimentId : null;
  }
  return null;
};

const slackApiPost = async <T extends Record<string, unknown>>({
  token,
  path,
  body,
}: {
  token: string;
  path: string;
  body: Record<string, unknown>;
}): Promise<T | null> => {
  const { stringBody, responseWithoutBody } = await cancellableFetch(
    `${SLACK_API_URL}/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    {
      maxTimeMs: 15000,
      maxContentSize: 1000,
    },
  );
  if (!responseWithoutBody.ok) return null;

  return JSON.parse(stringBody) as T;
};

export const maybeSendSlackDirectMessageForEvent = async ({
  event,
  eventWebHook,
}: {
  event: EventInterface;
  eventWebHook: EventWebHookInterface;
}) => {
  if (!DIRECT_MESSAGE_EVENT_NAMES.has(event.event)) return;

  const experimentId = getExperimentIdFromEvent(event);
  if (!experimentId) return;

  const token = await getSlackBotAccessTokenForWebhook({
    eventWebHookId: eventWebHook.id,
    organizationId: event.organizationId,
  });
  if (!token) return;

  const experiment = await getExperimentByIdForOrganization(
    event.organizationId,
    experimentId,
  );
  const ownerEmail = experiment?.owner?.includes("@")
    ? experiment.owner
    : undefined;
  if (!ownerEmail) return;

  const lookup = await slackApiPost<{
    ok?: boolean;
    user?: { id?: string };
  }>({
    token,
    path: "users.lookupByEmail",
    body: { email: ownerEmail },
  });
  const slackUserId = lookup?.ok ? lookup.user?.id : undefined;
  if (!slackUserId) return;

  const slackMessage =
    event.version &&
    (await getSlackMessageForNotificationEvent(event.data, event.id));
  if (!slackMessage) return;

  await slackApiPost({
    token,
    path: "chat.postMessage",
    body: {
      channel: slackUserId,
      text: slackMessage.text,
      blocks: slackMessage.blocks,
    },
  });
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
