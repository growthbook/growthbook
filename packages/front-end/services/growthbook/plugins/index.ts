export {
  GROWTHBOOK_ERROR_EVENT,
  growthbookErrorTrackingPlugin,
  captureError,
  buildErrorEventProperties,
  parseStackFrames,
} from "./growthbook-error-tracking";
export { GrowthBookErrorBoundary } from "./GrowthBookErrorBoundary";
export type { GrowthBookErrorBoundaryProps } from "./GrowthBookErrorBoundary";
export type {
  BuiltErrorEventProps,
  CaptureErrorOptions,
  ErrorTrackingStackFrame,
  GrowthBookErrorEventProps,
} from "./growthbook-error-tracking";
