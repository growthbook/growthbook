import { NotificationEvent } from "back-end/src/events/notification-events";

export const getDatadogMessageForNotificationEvent = async (
  event: NotificationEvent,
  eventId: string
): Promise<DatadogEventPayload | null> => {
  let invalidEvent: never;

  switch (event.event) {
    case "user.login":
      return {
        // title: `GrowthBook: ${event.user?.name ?? "a user"} has logged-in`,
        title: "",
        text: `%%% \n
## Test

        For markdown content.
        This [here](https://growthbook.io)
\n %%%`,
        tags: ["growthbookEvent:user.login", `eventId:${eventId}`],
      };

    case "feature.created":
    case "feature.updated":
    case "feature.deleted":
    case "experiment.created":
    case "experiment.updated":
    case "experiment.warning":
    case "experiment.info.significance":
    case "experiment.deleted":
      return null;

    case "webhook.test":
      return {
        title: "GrowthBook Webhook Event Test",
        text: `%%% \n
## Test

This is a test event for the GrowthBook webhook.
\n %%%`,
        tags: [
          "growthbook_event_type:webhook.test",
          `growthbook_event_id:${eventId}`,
        ],
      };

    default:
      invalidEvent = event;
      throw `Invalid event: ${invalidEvent}`;
  }
};

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
