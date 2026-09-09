// core+sessions bundle: everything in auto-wrapper.ts plus session replay,
// with page events, errors, and CWV on by default. rrweb is inlined (rollup
// external: () => false), so this stays a single self-contained script.
//
// How the defaults get in: auto-wrapper.ts constructs the instance in its
// module body, so nothing here can run first. ES modules evaluate imports
// in order, so auto-wrapper-plus-defaults.ts is imported before
// auto-wrapper and fills wrapperDefaults (auto-wrapper-defaults.ts) ahead of
// time. package.json declares sideEffects: false, which would let rollup
// drop this import; rollup.config.mjs sets ignoreSideEffectsForRoot for the
// wrapper bundles so it is kept. Keep this import first.
import "./auto-wrapper-plus-defaults";
import gb, { type WindowContext } from "./auto-wrapper";
import {
  sessionReplayPlugin,
  type SessionReplayOptions,
} from "./plugins/session-replay/index";

// window.growthbook_config.sessionReplay mirrors the plugin's own options
type PlusWindowContext = WindowContext & {
  sessionReplay?: SessionReplayOptions;
};

// Same script as auto-wrapper, still evaluating, so currentScript is ours
const dataContext: DOMStringMap = document.currentScript
  ? document.currentScript.dataset
  : {};
const windowContext: PlusWindowContext = window.growthbook_config || {};

// On by default; data-session-replay-disabled or sessionReplay.enabled = false
// turns it off
const replay = windowContext.sessionReplay || {};
const sessionReplayDisabled =
  replay.enabled === false ||
  dataContext.sessionReplayDisabled === "" ||
  dataContext.sessionReplayDisabled === "true";

if (!sessionReplayDisabled) {
  sessionReplayPlugin({
    ...replay,
    ingestorHost:
      replay.ingestorHost ||
      windowContext.eventIngestorHost ||
      dataContext.eventIngestorHost,
    privacy: replay.privacy || windowContext.privacy,
  })(gb);
}

export default gb;
