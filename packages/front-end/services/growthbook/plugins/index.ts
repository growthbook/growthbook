export {
  EVENT_GROWTHBOOK_ERROR,
  growthbookErrorTrackingPlugin,
  captureError,
  buildErrorEventProperties,
  parseStackFrames,
} from "shared/error-tracking";
export type {
  BuiltErrorEventProps,
  CaptureErrorOptions,
  ErrorTrackingStackFrame,
  GrowthBookErrorEventProps,
} from "shared/error-tracking";
export { GrowthBookErrorBoundary } from "./GrowthBookErrorBoundary";
export type { GrowthBookErrorBoundaryProps } from "./GrowthBookErrorBoundary";
