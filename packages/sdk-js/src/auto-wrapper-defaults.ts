import type { AutoEventsSettings } from "./plugins/auto-events/index";

// Settings a bundle entrypoint applies beneath the customer's own config.
// auto-wrapper.ts reads this at module evaluation, so an entrypoint must
// import the module that fills it in before importing auto-wrapper.
export const wrapperDefaults: { autoEvents: AutoEventsSettings } = {
  autoEvents: {},
};
