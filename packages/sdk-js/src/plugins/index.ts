export { autoAttributesPlugin } from "./auto-attributes";
export { growthbookTrackingPlugin } from "./growthbook-tracking";
export {
  growthbookErrorTrackingPlugin,
  captureGrowthBookError,
  buildErrorEventProperties,
  parseStackFrames,
} from "./growthbook-error-tracking";
export type {
  BuiltErrorEventProps,
  CaptureGrowthBookErrorOptions,
  ErrorTrackingStackFrame,
  GrowthBookErrorEventProps,
} from "./growthbook-error-tracking";
export { thirdPartyTrackingPlugin } from "./third-party-tracking";
export {
  devtoolsPlugin,
  devtoolsNextjsPlugin,
  devtoolsExpressPlugin,
  getDebugScriptContents,
  getDebugEvent,
} from "./devtools";

// Types must be exported separately, otherwise rollup includes them in the javascript output which breaks things
export type {
  DevtoolsState,
  ExpressRequestCompat,
  NextjsReadonlyRequestCookiesCompat,
  NextjsRequestCompat,
  LogEvent,
  SdkInfo,
} from "./devtools";
