export { autoAttributesPlugin } from "./auto-attributes";
export { growthbookTrackingPlugin } from "./growthbook-tracking";
export { thirdPartyTrackingPlugin } from "./third-party-tracking";
export {
  sessionReplayPlugin,
  scrubUrl,
  GB_BLOCK_CLASS,
  GB_MASK_CLASS,
  GB_IGNORE_CLASS,
} from "./session-replay";
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
export type {
  SessionReplayPrivacyConfig,
  SessionReplayUrlScrubberConfig,
  MaskableInputType,
} from "./session-replay";
