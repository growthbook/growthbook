// core+sessions bundle: everything in auto-wrapper.ts plus session replay,
// with page events, errors, and CWV on by default. rrweb is inlined (rollup
// external: () => false), so this stays a single self-contained script.
// The defaults module must be imported before auto-wrapper evaluates.
import "./auto-wrapper-plus-defaults";
import gb, {
  dataContext,
  windowContext,
  type WindowContext,
} from "./auto-wrapper";
import {
  sessionReplayPlugin,
  type SessionReplayOptions,
} from "./plugins/session-replay/index";

// window.growthbook_config.sessionReplay mirrors the plugin's own options
type PlusWindowContext = WindowContext & {
  sessionReplay?: SessionReplayOptions;
};

// On by default; data-session-replay-disabled or sessionReplay.enabled = false
// turns it off
const replay = (windowContext as PlusWindowContext).sessionReplay || {};
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
