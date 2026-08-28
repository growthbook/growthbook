export { autoAttributesPlugin } from "./auto-attributes";
export { growthbookTrackingPlugin } from "./growthbook-tracking";
export { thirdPartyTrackingPlugin } from "./third-party-tracking";
export {
  devtoolsPlugin,
  devtoolsNextjsPlugin,
  devtoolsExpressPlugin,
  getDebugScriptContents,
  getDebugEvent,
} from "./devtools";

// Types must be exported separately, otherwise rollup includes them in the javascript output which breaks things
export type { TrackingTransport } from "./growthbook-tracking";
export type {
  DevtoolsState,
  ExpressRequestCompat,
  NextjsReadonlyRequestCookiesCompat,
  NextjsRequestCompat,
  LogEvent,
  SdkInfo,
} from "./devtools";

// Session-replay types only — the plugin function ships via the auto-wrapper-plus
// bundle and is intentionally excluded above.
export type {
  SessionReplayPrivacyConfig,
  MaskableInputType,
  SessionReplayUrlScrubberConfig,
} from "./session-replay";
