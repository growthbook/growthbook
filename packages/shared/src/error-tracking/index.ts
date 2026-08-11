export {
  EVENT_GROWTHBOOK_ERROR,
  growthbookErrorTrackingPlugin,
  captureError,
  buildErrorEventProperties,
  parseStackFrames,
} from "./growthbook-error-tracking";
export type {
  BuiltErrorEventProps,
  CaptureErrorOptions,
  ErrorTrackingStackFrame,
  GrowthBookErrorEventProps,
} from "./growthbook-error-tracking";
