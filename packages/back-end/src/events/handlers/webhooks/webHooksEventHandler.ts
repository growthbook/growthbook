import {
  getEventWebHookById,
  getAllEventWebHooksForEvent,
} from "back-end/src/models/EventWebhookModel";
import { NotificationEventHandler } from "back-end/src/events/notifiers/EventNotifier";
import {
  getFilterDataForNotificationEvent,
  filterEventForEnvironments,
} from "back-end/src/events/handlers/utils";
import { EventWebHookNotifier } from "./EventWebHookNotifier.js";

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler: NotificationEventHandler = async (event) => {
  const { tags, projects } = getFilterDataForNotificationEvent(event.data) || {
    tags: [],
    projects: [],
  };

  const eventWebHooks = await (async () => {
    if (event.data.event === "webhook.test") {
      const webhookId = event.version
        ? event.data.data.object.webhookId
        : event.data.data.webhookId;

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
          eventName: event.data.event,
          enabled: true,
          tags,
          projects,
        })) || []
      ).filter(({ environments = [] }) =>
        filterEventForEnvironments({ event: event.data, environments }),
      );
    }
  })();

  eventWebHooks.forEach((eventWebHook) => {
    const notifier = new EventWebHookNotifier({
      eventId: event.id,
      eventWebHookId: eventWebHook.id,
    });
    notifier.enqueue();
  });
};
