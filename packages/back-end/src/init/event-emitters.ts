import { getEventEmitterInstance } from "../services/event-emitter";
import { EmittedEvents } from "../events/base-types";
import { webHooksEventHandler } from "../events/handlers/webhooks/webHooksEventHandler";

let initialized = false;

export const initializeEventEmitters = () => {
  if (initialized) {
    console.warn("Not re-initializing event emitters.");
    return;
  }

  const eventEmitter = getEventEmitterInstance();

  eventEmitter.on(EmittedEvents.EVENT_CREATED, (eventId: string) => {
    console.log(
      "EventEmitter -> emitted:",
      EmittedEvents.EVENT_CREATED,
      eventId
    );

    // slackEventHandler(event);
    webHooksEventHandler(eventId);
  });

  // Ensures we do not register listeners more than once
  initialized = true;
};
