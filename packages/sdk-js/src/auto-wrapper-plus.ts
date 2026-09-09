// core+sessions bundle: everything in auto.js plus session replay, with page
// events, errors, and CWV on by default. rrweb is inlined (rollup external:
// () => false), so this stays a single self-contained script.
import { bootstrap, type WindowContext } from "./auto-wrapper-core";
import {
  sessionReplayPlugin,
  type SessionReplayOptions,
} from "./plugins/session-replay/index";

// window.growthbook_config.sessionReplay mirrors the plugin's own options
type PlusWindowContext = WindowContext & {
  sessionReplay?: SessionReplayOptions;
};

// A fresh opt-in, so the low-risk categories are on out of the box at the
// plugin defaults (10% sample, hashed on the auto-attributes id).
// Clickstream stays opt-in because it captures element text.
const { gb, dataContext, windowContext } = bootstrap({
  autoEvents: { pageEvents: true, errors: true, cwv: true },
});

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

// Default export only: the IIFE assigns it to window._growthbook
export default gb;
