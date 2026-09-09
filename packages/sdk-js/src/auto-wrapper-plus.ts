// core+sessions bundle: everything in auto-wrapper.ts plus session replay.
// rrweb is inlined (rollup external: () => false), so this stays a single
// self-contained script.
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
