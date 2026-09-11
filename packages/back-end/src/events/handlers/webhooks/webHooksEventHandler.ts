import {
  getEventWebHookById,
  getAllEventWebHooksForEvent,
} from "back-end/src/models/EventWebhookModel";
import { NotificationEventHandler } from "back-end/src/events/notifiers/EventNotifier";
import {
  getFilterDataForNotificationEvent,
  filterEventForEnvironments,
} from "back-end/src/events/handlers/utils";
import { EventWebHookNotifier } from "./EventWebHookNotifier";

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler: NotificationEventHandler = async (event) => {
  const { data: payload, version } = event;
  const { tags, projects } = getFilterDataForNotificationEvent(payload) || {
    tags: [],
    projects: [],
  };

  const eventWebHooks = await (async () => {
    if (payload.event === "webhook.test") {
      const webhookId = version
        ? payload.data.object.webhookId
        : payload.data.webhookId;

      const webhook = await getEventWebHookById(
        webhookId,
        event.organizationId,
      );

      if (!webhook) return [];

      return [webhook];
    } else {
      return (
        (await getAllEventWebHooksForEvent({
          organizationId: event.organizationId,
          eventName: payload.event,
          enabled: true,
          tags,
          projects,
        })) || []
      ).filter(({ environments = [] }) =>
        filterEventForEnvironments({ event: payload, environments }),
      );
    }
  })();

  eventWebHooks.forEach((eventWebHook) => {
    const apiVersion = eventWebHook.apiVersion ?? "2024-07-31";
    const count =
      eventWebHook.payloadType === "json" &&
      apiVersion === "2024-07-31" &&
      version &&
      payload.event === "experiment.info.significance" &&
      "changes" in payload.data.object
        ? payload.data.object.changes.length
        : 1;
    for (let changeIndex = 0; changeIndex < count; changeIndex++) {
      const notifier = new EventWebHookNotifier({
        eventId: event.id,
        eventWebHookId: eventWebHook.id,
        delivery: {
          payloadType: eventWebHook.payloadType || "raw",
          apiVersion,
          changeIndex,
        },
      });
      notifier.enqueue();
    }
  });
};
