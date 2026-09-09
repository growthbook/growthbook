import type { AutoEventsSettings } from "./plugins/auto-events/index";

// Settings a bundle entrypoint applies beneath the customer's own config.
// auto-wrapper.ts reads this once at module evaluation, so an entrypoint
// must import the module that fills it in before importing auto-wrapper.
// auto.js leaves it empty; core+sessions fills it from
// auto-wrapper-plus-defaults.ts.
export const wrapperDefaults: { autoEvents: AutoEventsSettings } = {
  autoEvents: {},
};
