export { autoAttributesPlugin } from "./auto-attributes";
export { growthbookTrackingPlugin } from "./growthbook-tracking";
export { thirdPartyTrackingPlugin } from "./third-party-tracking";
export {
  configureGbSession,
  getOrCreateGbSessionId,
  resolveSessionId,
} from "./utils/gb-session";
export {
  devtoolsPlugin,
  devtoolsNextjsPlugin,
  devtoolsExpressPlugin,
  getDebugScriptContents,
  getDebugEvent,
} from "./devtools";

// Types must be exported separately, otherwise rollup includes them in the javascript output which breaks things
export type { AutoAttributeSettings } from "./auto-attributes";
export type { TrackingTransport } from "./growthbook-tracking";
export type { Trackers } from "./third-party-tracking";
export type { GbSessionConfig } from "./utils/gb-session";
export type {
  DevtoolsState,
  ExpressRequestCompat,
  NextjsReadonlyRequestCookiesCompat,
  NextjsRequestCompat,
  LogEvent,
  SdkInfo,
} from "./devtools";

// Session-replay types only — the plugin function is intentionally excluded
// here (rrweb is heavy); it ships via the auto-wrapper-plus bundle and the
// "@growthbook/growthbook/plugins/session-replay" subpath export.
export type {
  SessionReplayPrivacyConfig,
  MaskableInputType,
  SessionReplayUrlScrubberConfig,
} from "./session-replay";
