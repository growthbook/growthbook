import { KnownBlock } from "@slack/types";
import formatNumber from "number-format.js";
import { logger } from "back-end/src/util/logger";
import { cancellableFetch } from "back-end/src/util/http.util";
import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "back-end/src/events/notification-events";
import { EventInterface } from "back-end/types/event";
import { getEvent } from "back-end/src/models/EventModel";
import { SlackIntegrationInterface } from "back-end/types/slack-integration";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import {
  FilterDataForNotificationEvent,
  getFilterDataForNotificationEvent,
} from "back-end/src/events/handlers/utils";
import { ExperimentWarningNotificationPayload } from "back-end/src/validators/experiment-warnings";
import { ExperimentInfoSignificancePayload } from "back-end/src/validators/experiment-info";
import { ExperimentDecisionNotificationPayload } from "back-end/src/validators/experiment-decision";
import {
  SafeRolloutDecisionNotificationPayload,
  SafeRolloutUnhealthyNotificationPayload,
} from "back-end/src/validators/safe-rollout-notifications";
import {
  DiffResult,
} from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import omit from "lodash/omit";
import pick from "lodash/pick";


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
      return buildSlackMessageForExperimentCreatedEvent(
        event.data.object,
        eventId,
      );

    case "experiment.updated":
      return buildSlackMessageForExperimentUpdatedEvent(
        event.data.object,
        eventId,
      );

    case "experiment.warning":
      return buildSlackMessageForExperimentWarningEvent(event.data.object);

    case "experiment.info.significance":
      return buildSlackMessageForExperimentInfoSignificanceEvent(
        event.data.object,
      );

    case "experiment.deleted":
      return buildSlackMessageForExperimentDeletedEvent(
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
      return buildSlackMessageForExperimentCreatedEvent(
        event.data.current,
        eventId,
      );

    case "experiment.updated":
      return buildSlackMessageForExperimentUpdatedEvent(
        event.data.current,
        eventId,
      );

    case "experiment.warning":
      return buildSlackMessageForExperimentWarningEvent(event.data);

    case "experiment.deleted":
      return buildSlackMessageForExperimentDeletedEvent(
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

  if (event.data.user.type === "api_key")
    return `an API request with key ending in ...${event.data.user.apiKey.slice(
      -4,
    )}`;
  return `${event.data.user.name} (${event.data.user.email})`;
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

  // Check if we have changes data to format
  if (event?.data?.data && "changes" in event.data.data) {
    const formatOptions: FormatOptions = {
      itemLabelFields: [
        "type",
        "value",
        "coverage",
        "condition",
        "savedGroupTargeting",
        "prerequisites",
      ],
      includeRawJson: false,
      maxJsonLength: 600,
      excludedFields: ["dateUpdated", "date", "__v", "_id"],
    };

    const formattedDiff = formatDiffForSlack(
      event.data.data.changes as DiffResult,
      formatOptions,
    );
    changeBlocks = formattedDiff.blocks;
  }

  const text = `The feature ${featureId} has been updated by ${eventUser}`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The feature *${featureId}* has been updated ${eventUser}.` +
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

// region Event-specific messages -> Experiment

export const getExperimentUrlFormatted = (experimentId: string): string =>
  `\n• <${APP_ORIGIN}/experiment/${experimentId}|View Experiment>`;

export const getExperimentUrlAndNameFormatted = (
  experimentId: string,
  experimentName: string,
): string => `<${APP_ORIGIN}/experiment/${experimentId}|${experimentName}>`;

const buildSlackMessageForExperimentCreatedEvent = (
  { id: experimentId, name: experimentName }: { id: string; name: string },
  eventId: string,
): SlackMessage => {
  const text = `The experiment ${experimentName} has been created`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The experiment *${experimentName}* has been created.` +
            getExperimentUrlFormatted(experimentId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentUpdatedEvent = (
  { id: experimentId, name: experimentName }: { id: string; name: string },
  eventId: string,
): SlackMessage => {
  const text = `The experiment ${experimentName} has been updated`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The experiment *${experimentName}* has been updated.` +
            getExperimentUrlFormatted(experimentId) +
            getEventUrlFormatted(eventId),
        },
      },
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

const buildSlackMessageForExperimentDeletedEvent = (
  experimentName: string,
  eventId: string,
): SlackMessage => {
  const text = `The experiment ${experimentName} has been deleted`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The experiment *${experimentName}* has been deleted.` +
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
      description ? ` ${description}` : null
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
      description ? ` ${description}` : null
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
      description ? ` ${description}` : null
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
}

interface ItemFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

interface HierarchicalValue {
  key: string;
  changes?: {
    added?: Record<string, unknown>[];
    removed?: Record<string, unknown>[];
    modified?: Array<{
      id: string;
      oldValue?: unknown;
      newValue: unknown;
      fieldChanges?: ItemFieldChange[];
      oldIndex?: number;
      newIndex?: number;
      steps?: number;
    }>;
    orderSummaries?: Array<
      | {
          type: "insertShift";
          insertIndex: number;
          direction: "down" | "up";
          affectedCount: number;
        }
      | {
          type: "reorderShift";
          movedId: string;
          fromIndex: number;
          toIndex: number;
          direction: "down" | "up";
          affectedCount: number;
        }
      | {
          type: "deleteShift";
          deleteIndex: number;
          direction: "up" | "down";
          affectedCount: number;
        }
    >;
  };
  added?: Record<string, unknown>;
  removed?: Record<string, unknown>;
  modified?: Array<{
    key: string;
    oldValue?: unknown;
    newValue?: unknown;
    values?: HierarchicalValue[];
  }>;
  values?: HierarchicalValue[];
}

interface SimpleModification {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

interface HierarchicalModification {
  key: string;
  values: HierarchicalValue[];
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  modified: Array<SimpleModification | HierarchicalModification>;
}

type ModificationItem = SimpleModification | HierarchicalModification;

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
    excludedFields: [],
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

  const getItemLabel = (obj: unknown, position?: number, maxLength?: number): string => {
    const effectiveMaxLength = maxLength || Math.min(opts.maxJsonLength, 120);
    
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
        return position !== undefined ? `#${position} (${truncated})` : truncated;
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
            ([key, value]) => !isEmpty(value) && !excludedFields.includes(key) && key !== "__index",
          ),
        );
        const json = JSON.stringify(filtered);
        const truncated = `\`${truncate(json, effectiveMaxLength)}\``;
        return position !== undefined ? `#${position} (${truncated})` : truncated;
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
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `⊳ *added properties*\n\`\`\`\n${truncate(JSON.stringify(cleanedAdded, null, 2), opts.maxJsonLength)}\n\`\`\``,
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

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${mod.key}*\nold: ${getItemLabel(mod.oldValue)}\nnew: ${getItemLabel(mod.newValue)}`,
        },
      });
    } else if (isHierarchicalModification(mod)) {
      if (excludedFields.includes(mod.key)) return;

      const formatHierarchicalChanges = (
        values: HierarchicalValue[],
      ): string => {
        const sections: string[] = [];

        values.forEach((value) => {
          sections.push(`\t*${value.key}:*`);

          if (value.added && Object.keys(value.added).length > 0) {
            sections.push(
              `\t⊳ *added:* ${getItemLabel(value.added)}`,
            );
          }

          if (value.removed && Object.keys(value.removed).length > 0) {
            sections.push(
              `\t⊳ *removed:* ${getItemLabel(value.removed)}`,
            );
          }

          if (value.modified && value.modified.length > 0) {
            value.modified.forEach((change: ModificationItem) => {
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
             if (value.changes.added?.length) {
               const labels = value.changes.added.map(
                 (item) => {
                   const index = (item as Record<string, unknown>).__index as number;
                   const position = typeof index === "number" ? `#${index + 1}` : "";
                   return `\t  • ${position} (${getItemLabel(item)})`;
                 },
               );
               sections.push(`\t⊳ *added ${value.key}:*\n${labels.join("\n")}`);
               if (opts.includeRawJson) {
                 sections.push(
                   truncate(
                     `\`\`\`\n${truncate(JSON.stringify(
                       value.changes.added.map((item) =>
                         typeof item === "object" && item !== null
                           ? omit(
                               item as Record<string, unknown>,
                               [...excludedFields, "__index"],
                             )
                           : item,
                       ),
                     ), opts.maxJsonLength)}\n\`\`\``,
                     opts.maxJsonLength,
                   ),
                 );
               }
             }
            if (value.changes.removed?.length) {
              const labels = value.changes.removed.map(
                (item) => {
                  const index = (item as Record<string, unknown>).__index as number;
                  const position = typeof index === "number" ? `#${index + 1}` : "";
                  return `\t  • ${position} (${getItemLabel(item)})`;
                },
              );
              sections.push(`\t⊳ *removed ${value.key}:*\n${labels.join("\n")}`);
              if (opts.includeRawJson) {
                sections.push(
                  truncate(
                     `\`\`\`\n${truncate(JSON.stringify(
                       value.changes.removed.map((item) =>
                         typeof item === "object" && item !== null
                           ? omit(
                               item as Record<string, unknown>,
                               [...excludedFields, "__index"],
                             )
                           : item,
                       ),
                     ), opts.maxJsonLength)}\n\`\`\``,
                    opts.maxJsonLength,
                  ),
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
                   const newValue = (change as unknown as { newValue?: unknown }).newValue;
                   const index = newValue && typeof newValue === "object" && "__index" in newValue 
                     ? (newValue as Record<string, unknown>).__index as number
                     : change.newIndex;
                   const position =
                     typeof index === "number"
                       ? `#${index + 1} `
                       : "";
                   updateLines.push(
                     `\t• ${position}${label}\n${fieldLines.join("\n")}`,
                   );
                   continue;
                 }

                const newValue = (change as unknown as { newValue?: unknown }).newValue;
                const index = newValue && typeof newValue === "object" && "__index" in newValue 
                  ? (newValue as Record<string, unknown>).__index as number
                  : change.newIndex;
                const position =
                  typeof index === "number"
                    ? `#${index + 1} `
                    : "";
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
        lines.push(
          `• added: ${getItemLabel(mod.added)}`,
        );
      }
      if (mod.removed && Object.keys(mod.removed).length > 0) {
        lines.push(
          `• removed: ${getItemLabel(mod.removed)}`,
        );
      }
      if (mod.modified && mod.modified.length > 0) {
        mod.modified.forEach((change: ModificationItem) => {
          if (excludedFields.includes(change.key)) return;
          if (isSimpleModification(change)) {
            lines.push(
              `• modified ${change.key}: ${getItemLabel(change.oldValue)} → ${getItemLabel(change.newValue)}`,
            );
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