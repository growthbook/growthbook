import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "back-end/src/events/notification-events";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { ExperimentWarningNotificationPayload } from "back-end/src/validators/experiment-warnings";
import { ExperimentInfoSignificancePayload } from "back-end/src/validators/experiment-info";
import { ExperimentDecisionNotificationPayload } from "back-end/src/validators/experiment-decision";
import {
  SafeRolloutDecisionNotificationPayload,
  SafeRolloutUnhealthyNotificationPayload,
} from "back-end/src/validators/safe-rollout-notifications";

export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
  };
  timestamp?: string;
};

export type DiscordMessage = {
  content?: string;
  embeds?: DiscordEmbed[];
};

const DISCORD_COLORS = {
  success: 0x00ff00, // Green
  warning: 0xffa500, // Orange
  danger: 0xff0000, // Red
  info: 0x0099ff, // Blue
  neutral: 0x9b59b6, // Purple
};

export const getDiscordMessageForNotificationEvent = async (
  event: NotificationEvent,
  eventId: string,
): Promise<DiscordMessage | null> => {
  let invalidEvent: never;

  switch (event.event) {
    case "user.login":
      return null;

    case "user.view_experiment":
      return null;

    case "feature.created":
      return buildDiscordMessageForFeatureCreatedEvent(
        event.data.object.id,
        eventId,
      );

    case "feature.updated":
      return buildDiscordMessageForFeatureUpdatedEvent(
        event.data.object.id,
        eventId,
      );

    case "feature.deleted":
      return buildDiscordMessageForFeatureDeletedEvent(
        event.data.object.id,
        eventId,
      );

    case "feature.saferollout.ship":
      return buildDiscordMessageForSafeRolloutShipEvent(
        event.data.object,
        eventId,
      );

    case "feature.saferollout.rollback":
      return buildDiscordMessageForSafeRolloutRollbackEvent(
        event.data.object,
        eventId,
      );

    case "feature.saferollout.unhealthy":
      return buildDiscordMessageForSafeRolloutUnhealthyEvent(
        event.data.object,
        eventId,
      );

    case "experiment.created":
      return buildDiscordMessageForExperimentCreatedEvent(
        event.data.object,
        eventId,
      );

    case "experiment.updated":
      return buildDiscordMessageForExperimentUpdatedEvent(
        event.data.object,
        eventId,
      );

    case "experiment.warning":
      return buildDiscordMessageForExperimentWarningEvent(event.data.object);

    case "experiment.info.significance":
      return buildDiscordMessageForExperimentInfoSignificanceEvent(
        event.data.object,
      );

    case "experiment.decision.ship":
    case "experiment.decision.rollback":
    case "experiment.decision.review":
      return buildDiscordMessageForExperimentDecisionEvent(
        event.data.object,
        eventId,
      );

    case "experiment.deleted":
      return buildDiscordMessageForExperimentDeletedEvent(
        event.data.object,
        eventId,
      );

    case "webhook.test":
      return {
        embeds: [
          {
            title: "Test Event",
            description: `*Hi there! 👋*\nThis is a *test event* from GrowthBook to see if the params for webhook ${event.data.object.webhookId} are correct.`,
            color: 39423,
          },
        ],
      };

    default:
      invalidEvent = event;
      throw `Invalid event: ${invalidEvent}`;
  }
};

export const getDiscordMessageForLegacyNotificationEvent = async (
  event: LegacyNotificationEvent,
  eventId: string,
): Promise<DiscordMessage | null> => {
  const title = event.event.replace(/\./g, " ").replace(/_/g, " ");
  const capitalizedTitle = title.charAt(0).toUpperCase() + title.slice(1);

  return {
    embeds: [
      {
        title: capitalizedTitle,
        description: `A ${event.event} event has occurred`,
        color: DISCORD_COLORS.info,
        fields: [
          {
            name: "Event ID",
            value: eventId,
            inline: true,
          },
        ],
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
};

// Feature Events
function buildDiscordMessageForFeatureCreatedEvent(
  featureId: string,
  _eventId: string,
): DiscordMessage {
  return {
    embeds: [
      {
        title: "🚀 Feature Created",
        description: `A new feature has been created`,
        color: DISCORD_COLORS.success,
        fields: [
          {
            name: "Feature ID",
            value: featureId,
            inline: true,
          },
        ],
        url: `${APP_ORIGIN}/features/${featureId}`,
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function buildDiscordMessageForFeatureUpdatedEvent(
  featureId: string,
  _eventId: string,
): DiscordMessage {
  return {
    embeds: [
      {
        title: "✏️ Feature Updated",
        description: `A feature has been updated`,
        color: DISCORD_COLORS.info,
        fields: [
          {
            name: "Feature ID",
            value: featureId,
            inline: true,
          },
        ],
        url: `${APP_ORIGIN}/features/${featureId}`,
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function buildDiscordMessageForFeatureDeletedEvent(
  featureId: string,
  _eventId: string,
): DiscordMessage {
  return {
    embeds: [
      {
        title: "🗑️ Feature Deleted",
        description: `A feature has been deleted`,
        color: DISCORD_COLORS.danger,
        fields: [
          {
            name: "Feature ID",
            value: featureId,
            inline: true,
          },
        ],
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

// Safe Rollout Events
function buildDiscordMessageForSafeRolloutShipEvent(
  data: SafeRolloutDecisionNotificationPayload,
  _eventId: string,
): DiscordMessage {
  return {
    embeds: [
      {
        title: "🚢 Safe Rollout Shipped",
        description: `Feature ${data.featureId} has been shipped`,
        color: DISCORD_COLORS.success,
        fields: [
          {
            name: "Feature ID",
            value: data.featureId,
            inline: true,
          },
          {
            name: "Environment",
            value: data.environment,
            inline: true,
          },
        ],
        url: `${APP_ORIGIN}/features/${data.featureId}`,
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function buildDiscordMessageForSafeRolloutRollbackEvent(
  data: SafeRolloutDecisionNotificationPayload,
  _eventId: string,
): DiscordMessage {
  return {
    embeds: [
      {
        title: "⏪ Safe Rollout Rolled Back",
        description: `Feature ${data.featureId} has been rolled back`,
        color: DISCORD_COLORS.warning,
        fields: [
          {
            name: "Feature ID",
            value: data.featureId,
            inline: true,
          },
          {
            name: "Environment",
            value: data.environment,
            inline: true,
          },
        ],
        url: `${APP_ORIGIN}/features/${data.featureId}`,
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function buildDiscordMessageForSafeRolloutUnhealthyEvent(
  data: SafeRolloutUnhealthyNotificationPayload,
  _eventId: string,
): DiscordMessage {
  const unhealthyReasons = data.unhealthyReason?.join(", ") || "Unknown";
  return {
    embeds: [
      {
        title: "⚠️ Safe Rollout Unhealthy",
        description: `Feature ${data.featureId} is experiencing issues`,
        color: DISCORD_COLORS.danger,
        fields: [
          {
            name: "Feature ID",
            value: data.featureId,
            inline: true,
          },
          {
            name: "Environment",
            value: data.environment,
            inline: true,
          },
          {
            name: "Reason",
            value: unhealthyReasons,
            inline: false,
          },
        ],
        url: `${APP_ORIGIN}/features/${data.featureId}`,
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

// Experiment Events
function buildDiscordMessageForExperimentCreatedEvent(
  { id: experimentId, name: experimentName }: { id: string; name: string },
  _eventId: string,
): DiscordMessage {
  return {
    embeds: [
      {
        title: "🧪 Experiment Created",
        description: `A new experiment has been created`,
        color: DISCORD_COLORS.success,
        fields: [
          {
            name: "Experiment",
            value: experimentName,
            inline: true,
          },
        ],
        url: `${APP_ORIGIN}/experiment/${experimentId}`,
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function buildDiscordMessageForExperimentUpdatedEvent(
  { id: experimentId, name: experimentName }: { id: string; name: string },
  _eventId: string,
): DiscordMessage {
  return {
    embeds: [
      {
        title: "✏️ Experiment Updated",
        description: `An experiment has been updated`,
        color: DISCORD_COLORS.info,
        fields: [
          {
            name: "Experiment",
            value: experimentName,
            inline: true,
          },
        ],
        url: `${APP_ORIGIN}/experiment/${experimentId}`,
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function buildDiscordMessageForExperimentWarningEvent(
  data: ExperimentWarningNotificationPayload,
): DiscordMessage {
  const fields = [];
  let description = "";
  let experimentId = "";
  let experimentName = "";

  switch (data.type) {
    case "auto-update":
      experimentName = data.experimentName;
      experimentId = data.experimentId;
      description = `Auto-update ${data.success ? "succeeded" : "failed"} for experiment ${experimentName}`;
      fields.push({
        name: "⚠️ Auto-Update Status",
        value: data.success ? "Succeeded ✅" : "Failed ❌",
        inline: false,
      });
      break;

    case "multiple-exposures":
      experimentName = data.experimentName;
      experimentId = data.experimentId;
      description = `Multiple exposures detected for experiment ${experimentName}`;
      fields.push({
        name: "⚠️ Multiple Exposures",
        value: `${data.usersCount} users (${data.percent.toFixed(2)}%)`,
        inline: false,
      });
      break;

    case "srm":
      experimentName = data.experimentName;
      experimentId = data.experimentId;
      description = `SRM (Sample Ratio Mismatch) detected for experiment ${experimentName}`;
      fields.push({
        name: "⚠️ SRM Warning",
        value: `Threshold exceeded: ${data.threshold}`,
        inline: false,
      });
      break;
  }

  return {
    embeds: [
      {
        title: "⚠️ Experiment Warning",
        description,
        color: DISCORD_COLORS.warning,
        fields: [
          {
            name: "Experiment",
            value: experimentName,
            inline: true,
          },
          ...fields,
        ],
        url: `${APP_ORIGIN}/experiment/${experimentId}`,
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function buildDiscordMessageForExperimentInfoSignificanceEvent(
  data: ExperimentInfoSignificancePayload,
): DiscordMessage {
  return {
    embeds: [
      {
        title: "📊 Experiment Reached Significance",
        description: `Experiment ${data.experimentName} has significant results`,
        color: DISCORD_COLORS.success,
        fields: [
          {
            name: "Metric",
            value: data.metricName,
            inline: true,
          },
          {
            name: "Variation",
            value: data.variationName,
            inline: true,
          },
          {
            name: "Status",
            value: data.winning ? "Winner 🏆" : "Significant",
            inline: true,
          },
          {
            name: "Stats Engine",
            value: data.statsEngine,
            inline: true,
          },
          {
            name: "Critical Value",
            value: data.criticalValue.toFixed(4),
            inline: true,
          },
        ],
        url: `${APP_ORIGIN}/experiment/${data.experimentId}`,
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function buildDiscordMessageForExperimentDecisionEvent(
  data: ExperimentDecisionNotificationPayload,
  _eventId: string,
): DiscordMessage {
  return {
    embeds: [
      {
        title: "✅ Experiment Decision Made",
        description: `A decision has been made for experiment ${data.experimentName}`,
        color: DISCORD_COLORS.success,
        fields: [
          {
            name: "Experiment",
            value: data.experimentName,
            inline: true,
          },
          {
            name: "Decision",
            value: data.decisionDescription || "Decision recorded",
            inline: false,
          },
        ],
        url: `${APP_ORIGIN}/experiment/${data.experimentId}`,
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function buildDiscordMessageForExperimentDeletedEvent(
  { name: experimentName }: { name: string },
  _eventId: string,
): DiscordMessage {
  return {
    embeds: [
      {
        title: "🗑️ Experiment Deleted",
        description: `An experiment has been deleted`,
        color: DISCORD_COLORS.danger,
        fields: [
          {
            name: "Experiment",
            value: experimentName,
            inline: true,
          },
        ],
        footer: {
          text: "GrowthBook",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
