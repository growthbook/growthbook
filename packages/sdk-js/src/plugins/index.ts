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

// Session-replay plugin is intentionally NOT re-exported here. It's
// currently distributed only via the auto-wrapper-plus IIFE bundle for
// cloud customers (see src/auto-wrapper-plus.ts + the corresponding
// rollup entry). The plan is a separate npm package
// (@growthbook/session-replays or similar) that hooks into the main
// @growthbook/growthbook package as a peer dependency — at which point
// it'll have its own publish flow with rrweb declared appropriately.
// Until then, importing sessionReplayPlugin via npm would fail at
// runtime because rrweb isn't a declared dependency of this package.
// The plugin source lives in ./session-replay and is reachable by
// internal relative imports (auto-wrapper-plus.ts uses this path).

// Types must be exported separately, otherwise rollup includes them in the javascript output which breaks things
export type {
  DevtoolsState,
  ExpressRequestCompat,
  NextjsReadonlyRequestCookiesCompat,
  NextjsRequestCompat,
  LogEvent,
  SdkInfo,
} from "./devtools";
