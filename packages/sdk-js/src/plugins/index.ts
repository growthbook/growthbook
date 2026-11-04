export { autoAttributesPlugin } from "./auto-attributes";
export {
  interleavePlugin,
  interleave,
  EVENT_INTERLEAVE_EXPOSURE,
} from "./interleave";
export { growthbookTrackingPlugin } from "./growthbook-tracking";
export { thirdPartyTrackingPlugin } from "./third-party-tracking";
export { autoEventsPlugin } from "./auto-events/index";
export type { AutoEventsSettings } from "./auto-events/index";
export {
  configureSession,
  getOrCreateSessionId,
  resolveSessionId,
} from "./utils/session";
export {
  tracingPlugin,
  getTracingTags,
  TRACING_TAG_EXPERIMENT_PREFIX,
} from "./tracing";
export {
  devtoolsPlugin,
  devtoolsNextjsPlugin,
  devtoolsExpressPlugin,
  getDebugScriptContents,
  getDebugEvent,
} from "./devtools";

// Types must be exported separately, otherwise rollup includes them in the javascript output which breaks things
export type { AutoAttributeSettings } from "./auto-attributes";
export type {
  InterleaveConfig,
  InterleavedItem,
  InterleaveExposure,
  InterleaveOptions,
  InterleavePluginOptions,
  InterleaveResult,
  InterleaveTrackingProps,
} from "./interleave";
export type {
  GrowthBookTrackingOptions,
  TrackingEventData,
  TrackingTransport,
} from "./growthbook-tracking";
export type { Trackers } from "./third-party-tracking";
export type { SessionConfig } from "./utils/session";
export type { PrivacySettings, UrlScrubSettings } from "./utils/privacy";
export type { TracingAssignment, TracingPluginOptions } from "./tracing";
export type {
  DevtoolsState,
  ExpressRequestCompat,
  NextjsReadonlyRequestCookiesCompat,
  NextjsRequestCompat,
  LogEvent,
  SdkInfo,
} from "./devtools";

// Session replay is intentionally absent (its types depend on rrweb); it ships
// via the auto-wrapper-plus bundle and the
// "@growthbook/growthbook/plugins/session-replay" subpath export.
