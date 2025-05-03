import formatNumber from "number-format.js";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { getEvent } from "back-end/src/models/EventModel";
import type { NotificationEvent } from "back-end/src/events/notification-events";
import type { ExperimentWarningNotificationPayload } from "back-end/src/validators/experiment-warnings";
import { ExperimentInfoSignificancePayload } from "back-end/src/validators/experiment-info";

export async function getDatadogEventForNotificationEvent(
  event: NotificationEvent,
  eventId: string
): Promise<DatadogEventPayload | null> {
  let invalidEvent: never;

  switch (event.event) {
    case "user.login":
      return buildDatadogEventForUserLoginEvent(eventId);

    case "feature.created":
      return buildDatadogEventForFeatureCreatedEvent(
        event.data.object.id,
        eventId
      );

    case "feature.updated":
      return buildDatadogEventForFeatureUpdatedEvent(
        event.data.object.id,
        eventId
      );

    case "feature.deleted":
      return buildDatadogEventForFeatureDeletedEvent(
        event.data.object.id,
        eventId
      );

    case "experiment.created":
      return buildDatadogEventForExperimentCreatedEvent(
        event.data.object,
        eventId
      );

    case "experiment.updated":
      return buildDatadogEventForExperimentUpdatedEvent(
        event.data.object,
        eventId
      );

    case "experiment.warning":
      return buildDatadogEventForExperimentWarningEvent(
        event.data.object,
        eventId
      );

    case "experiment.info.significance":
      return buildDatadogEventForExperimentInfoSignificanceEvent(
        event.data.object,
        eventId
      );

    case "experiment.deleted":
      return buildDatadogEventForExperimentDeletedEvent(
        event.data.object.name,
        eventId
      );

    case "webhook.test":
      return buildDatadogEventForWebhookTestEvent(
        event.data.object.webhookId,
        eventId
      );

    default:
      invalidEvent = event;
      throw `Invalid event: ${invalidEvent}`;
  }
}

const getFeatureUrlFormatted = (featureId: string): string =>
  `• [View Feature](${APP_ORIGIN}/features/${featureId})`;

const getExperimentUrlFormatted = (experimentId: string): string =>
  `• [View Experiment](${APP_ORIGIN}/experiment/${experimentId})`;

const getExperimentUrlAndNameFormatted = (
  experimentId: string,
  experimentName: string
): string => `[${experimentName}](${APP_ORIGIN}/experiment/${experimentId})`;

const getEventUrlFormatted = (eventId: string): string =>
  `• [View Event](${APP_ORIGIN}/events/${eventId})`;

const getEventUserFormatted = async (eventId: string) => {
  const event = await getEvent(eventId);

  if (!event || !event.data?.user) return "an unknown user";

  if (event.data.user.type === "api_key") {
    return `an API request with key ending in ...${event.data.user.apiKey.slice(
      -4
    )}`;
  }

  return `${event.data.user.name} (${event.data.user.email})`;
};

async function buildDatadogEventForUserLoginEvent(
  eventId: string
): Promise<DatadogEventPayload | null> {
  const eventUser = await getEventUserFormatted(eventId);

  return {
    title: `${eventUser} has logged into GrowthBook`,
    text: `%%% \n
${eventUser} has logged-in.

${getEventUrlFormatted(eventId)}
\n %%%`,
    sourceTypeName: "growthbook",
    tags: ["growthbookEvent:user.login", `eventId:${eventId}`],
  };
}

async function buildDatadogEventForFeatureCreatedEvent(
  featureId: string,
  eventId: string
): Promise<DatadogEventPayload | null> {
  const eventUser = await getEventUserFormatted(eventId);
  return {
    title: `Feature ${featureId} created by ${eventUser}`,
    text: `%%% \n
${eventUser} has created the feature *${featureId}*.

${getFeatureUrlFormatted(featureId)}
${getEventUrlFormatted(eventId)}
\n %%%`,
    sourceTypeName: "growthbook",
    tags: ["growthbookEvent:feature.created", `eventId:${eventId}`],
  };
}

async function buildDatadogEventForFeatureUpdatedEvent(
  featureId: string,
  eventId: string
): Promise<DatadogEventPayload | null> {
  const eventUser = await getEventUserFormatted(eventId);
  return {
    title: `Feature ${featureId} updated by ${eventUser}`,
    text: `%%% \n
${eventUser} has updated the feature *${featureId}*.

${getFeatureUrlFormatted(featureId)}
${getEventUrlFormatted(eventId)}
\n %%%`,
    sourceTypeName: "growthbook",
    tags: ["growthbookEvent:feature.updated", `eventId:${eventId}`],
  };
}

async function buildDatadogEventForFeatureDeletedEvent(
  featureId: string,
  eventId: string
): Promise<DatadogEventPayload | null> {
  const eventUser = await getEventUserFormatted(eventId);
  return {
    title: `Feature ${featureId} deleted by ${eventUser}`,
    text: `%%% \n
${eventUser} has deleted the feature *${featureId}*.

${getEventUrlFormatted(eventId)}
\n %%%`,
    sourceTypeName: "growthbook",
    tags: ["growthbookEvent:feature.deleted", `eventId:${eventId}`],
  };
}

async function buildDatadogEventForExperimentCreatedEvent(
  { id: experimentId, name: experimentName }: { id: string; name: string },
  eventId: string
): Promise<DatadogEventPayload | null> {
  const eventUser = await getEventUserFormatted(eventId);

  return {
    title: `Experiment ${experimentName} created`,
    text: `%%% \n
${eventUser} has created the experiment ${getExperimentUrlAndNameFormatted(
      experimentId,
      experimentName
    )}.

${getExperimentUrlFormatted(experimentId)}
${getEventUrlFormatted(eventId)}
\n %%%`,
    sourceTypeName: "growthbook",
    tags: ["growthbookEvent:experiment.created", `eventId:${eventId}`],
  };
}

async function buildDatadogEventForExperimentUpdatedEvent(
  { id: experimentId, name: experimentName }: { id: string; name: string },
  eventId: string
): Promise<DatadogEventPayload | null> {
  const eventUser = await getEventUserFormatted(eventId);

  return {
    title: `Experiment ${experimentName} updated`,
    text: `%%% \n
${eventUser} has updated the experiment ${getExperimentUrlAndNameFormatted(
      experimentId,
      experimentName
    )}.

${getExperimentUrlFormatted(experimentId)}
${getEventUrlFormatted(eventId)}
\n %%%`,
    sourceTypeName: "growthbook",
    tags: ["growthbookEvent:experiment.updated", `eventId:${eventId}`],
  };
}

async function buildDatadogEventForExperimentWarningEvent(
  data: ExperimentWarningNotificationPayload,
  eventId: string
): Promise<DatadogEventPayload | null> {
  let invalidData: never;

  switch (data.type) {
    case "auto-update": {
      return {
        title: `Experiment ${data.experimentName} snapshot ${
          data.success ? "success" : "failure"
        }`,
        text: `%%% \n
Automatic snapshot creation for ${data.experimentName} ${
          data.success ? "succeeded" : "failed"
        }!

${getExperimentUrlFormatted(data.experimentId)}
${getEventUrlFormatted(eventId)}
\n %%%`,
        sourceTypeName: "growthbook",
        tags: ["growthbookEvent:experiment.warning", `eventId:${eventId}`],
      };
    }

    case "multiple-exposures": {
      const numberFormatter = (v: number) => formatNumber("#,##0.", v);
      const percentFormatter = (v: number) => formatNumber("#0.%", v * 100);

      return {
        title: `Experiment ${data.experimentName}: Multiple Exposures Warning`,
        text: `%%% \n
Multiple Exposures Warning for experiment ${
          data.experimentName
        }: ${numberFormatter(data.usersCount)} users (${percentFormatter(
          data.percent
        )}%) saw multiple variations and were automatically removed from results.

${getExperimentUrlFormatted(data.experimentId)}
${getEventUrlFormatted(eventId)}
\n %%%`,
        sourceTypeName: "growthbook",
        tags: ["growthbookEvent:experiment.warning", `eventId:${eventId}`],
      };
    }

    case "srm": {
      return {
        title: `Experiment ${data.experimentName}: Traffic Imbalance Warning`,
        text: `%%% \n
Traffic imbalance detected for experiment ${
          data.experimentName
        }: Sample Ratio Mismatch (SRM) p-value below ${data.threshold}.

${getExperimentUrlFormatted(data.experimentId)}
${getEventUrlFormatted(eventId)}
\n %%%`,
        sourceTypeName: "growthbook",
        tags: ["growthbookEvent:experiment.warning", `eventId:${eventId}`],
      };
    }

    default:
      invalidData = data;
      throw `Invalid data: ${invalidData}`;
  }
}

async function buildDatadogEventForExperimentInfoSignificanceEvent(
  {
    metricName,
    experimentName,
    experimentId,
    variationName,
    statsEngine,
    criticalValue,
    winning,
  }: ExperimentInfoSignificancePayload,
  eventId: string
): Promise<DatadogEventPayload | null> {
  const percentFormatter = (v: number) => {
    if (v > 0.99) {
      return ">99%";
    }
    if (v < 0.01) {
      return "<1%";
    }
    return formatNumber("#0.%", v * 100);
  };

  let text = "";
  if (statsEngine === "frequentist") {
    text = `In experiment ${experimentName}, metric ${metricName} for variation ${variationName} is ${
      winning ? "beating" : "losing to"
    } the baseline and has reached statistical significance (p-value = ${criticalValue.toFixed(
      3
    )}).`;
  } else {
    text = `In experiment ${experimentName}, metric ${metricName} for variation ${variationName} has ${
      winning ? "reached a" : "dropped to a"
    } ${percentFormatter(criticalValue)} chance to beat the baseline.`;
  }

  return {
    title: `Experiment ${experimentName}: Metric with statistical significance`,
    text: `%%% \n
${text}

${getExperimentUrlFormatted(experimentId)}
${getEventUrlFormatted(eventId)}
\n %%%`,
    sourceTypeName: "growthbook",
    tags: [
      "growthbookEvent:experiment.info.significance",
      `eventId:${eventId}`,
    ],
  };
}

async function buildDatadogEventForExperimentDeletedEvent(
  experimentName: string,
  eventId: string
): Promise<DatadogEventPayload | null> {
  const eventUser = await getEventUserFormatted(eventId);
  return {
    title: `Experiment ${experimentName} deleted`,
    text: `%%% \n
${eventUser} has deleted the experiment *${experimentName}*.

${getEventUrlFormatted(eventId)}
\n %%%`,
    sourceTypeName: "growthbook",
    tags: ["growthbookEvent:experiment.deleted", `eventId:${eventId}`],
  };
}

async function buildDatadogEventForWebhookTestEvent(
  webhookId: string,
  eventId: string
): Promise<DatadogEventPayload | null> {
  const eventUser = await getEventUserFormatted(eventId);
  return {
    title: `GrowthBook Test Event`,
    text: `%%% \n
This is a webhook test event for ${webhookId} triggered by ${eventUser}.

${getEventUrlFormatted(eventId)}
\n %%%`,
    sourceTypeName: "growthbook",
    tags: ["growthbookEvent:webhook.test", `eventId:${eventId}`],
  };
}

// From https://github.com/DataDog/datadog-api-client-typescript/blob/master/packages/datadog-api-client-v1/models/EventCreateRequest.ts#L14
type DatadogEventPayload = {
  /**
   * An arbitrary string to use for aggregation. Limited to 100 characters.
   * If you specify a key, all events using that key are grouped together in the Event Stream.
   */
  aggregationKey?: string;
  /**
   * If an alert event is enabled, set its type.
   * For example, `error`, `warning`, `info`, `success`, `user_update`,
   * `recommendation`, and `snapshot`.
   */
  alertType?:
    | "error"
    | "warning"
    | "info"
    | "success"
    | "user_update"
    | "recommendation"
    | "snapshot";
  /**
   * POSIX timestamp of the event. Must be sent as an integer (that is no quotes).
   * Limited to events no older than 18 hours
   */
  dateHappened?: number;
  /**
   * A device name.
   */
  deviceName?: string;
  /**
   * Host name to associate with the event.
   * Any tags associated with the host are also applied to this event.
   */
  host?: string;
  /**
   * The priority of the event. For example, `normal` or `low`.
   */
  priority?: "normal" | "low";
  /**
   * ID of the parent event. Must be sent as an integer (that is no quotes).
   */
  relatedEventId?: number;
  /**
   * The type of event being posted. Option examples include nagios, hudson, jenkins, my_apps, chef, puppet, git, bitbucket, etc.
   * A complete list of source attribute values [available here](https://docs.datadoghq.com/integrations/faq/list-of-api-source-attribute-value).
   */
  sourceTypeName?: string;
  /**
   * A list of tags to apply to the event.
   */
  tags?: Array<string>;
  /**
   * The body of the event. Limited to 4000 characters. The text supports markdown.
   * To use markdown in the event text, start the text block with `%%% \n` and end the text block with `\n %%%`.
   * Use `msg_text` with the Datadog Ruby library.
   */
  text: string;
  /**
   * The event title.
   */
  title: string;
};
