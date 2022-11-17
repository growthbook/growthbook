import { FeatureUpdatedNotifier } from "../events/notifiers/FeatureUpdatedNotifier";
import { FeatureUpdatedNotificationEvent } from "../events/base-events";
import { getEventEmitterInstance } from "../services/event-emitter";
import { webHooksHandleFeatureUpdatedNotification } from "../events/handlers/webhooks/webHooksHandleFeatureUpdatedNotification";
import { slackHandleFeatureUpdatedNotification } from "../events/handlers/slack/slackHandleFeatureUpdatedNotification";

let initialized = false;

export const initializeEventEmitters = () => {
  if (initialized) {
    console.warn("Not re-initializing event emitters.");
    return;
  }

  const eventEmitter = getEventEmitterInstance();

  eventEmitter.on(
    FeatureUpdatedNotifier.JOB_NAME,
    (event: FeatureUpdatedNotificationEvent) => {
      console.log("EventEmitter -> emitted:", FeatureUpdatedNotifier.JOB_NAME);

      webHooksHandleFeatureUpdatedNotification(event);
      slackHandleFeatureUpdatedNotification(event);
    }
  );

  // Ensures we do not register listeners more than once
  initialized = true;
};
