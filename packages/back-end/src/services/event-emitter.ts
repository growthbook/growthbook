import { EventEmitter } from "node:events";

let eventEmitter: EventEmitter;

export const getEventEmitterInstance = (): EventEmitter => {
  if (!eventEmitter) {
    eventEmitter = new EventEmitter();
  }

  return eventEmitter;
};
