import { getEventEmitterInstance } from "../services/event-emitter";
import { webHooksEventHandler } from "../events/handlers/webhooks/webHooksEventHandler";
import {
  APP_NOTIFICATION_EVENT_EMITTER_NAME,
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "../events/base-types";

let initialized = false;

export const initializeEventEmitters = () => {
  if (initialized) {
    console.warn("Not re-initializing event emitters.");
    return;
  }

  const eventEmitter = getEventEmitterInstance();

  eventEmitter.on(
    APP_NOTIFICATION_EVENT_EMITTER_NAME,
    (
      event: NotificationEventPayload<
        NotificationEventName,
        NotificationEventResource,
        unknown
      >
    ) => {
      console.log(
        "EventEmitter -> emitted:",
        APP_NOTIFICATION_EVENT_EMITTER_NAME
      );

      // slackEventHandler(event);
      webHooksEventHandler(event);
    }
  );

  // Ensures we do not register listeners more than once
  initialized = true;
};
