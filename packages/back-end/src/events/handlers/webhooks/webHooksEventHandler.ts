import { NotificationEventHandler } from "../../notifiers/EventNotifier";
import {
  getFilterDataForNotificationEvent,
  filterEventForEnvironments,
} from "../utils";
import { EventWebHookNotifier } from "./EventWebHookNotifier";

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler: NotificationEventHandler = async (
  event,
  context
) => {
  const { tags, projects } = getFilterDataForNotificationEvent(event.data) || {
    tags: [],
    projects: [],
  };

  const eventWebHooks = await (async () => {
    if (event.data.event === "webhook.test") {
      const webhook = await context.models.eventWebHooks.getById(
        event.data.data.webhookId
      );

      if (!webhook) return [];

      return [webhook];
    } else {
      return (
        (await context.models.eventWebHooks.getAllForEvent({
          eventName: event.data.event,
          enabled: true,
          tags,
          projects,
        })) || []
      ).filter(({ environments = [] }) =>
        filterEventForEnvironments({ event: event.data, environments })
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
