// core+sessions bundle: everything in auto-wrapper.ts plus session replay.
// rrweb is inlined (rollup external: () => false), so this stays a single
// self-contained script.
import gb, { dataContext, windowContext } from "./auto-wrapper";
import { sessionReplayPlugin } from "./plugins/session-replay/index";

// Enabled by default; data-session-replay-disabled or
// window.growthbook_config.sessionReplay.enabled = false turns it off
const replayConfig = windowContext.sessionReplay || {};
const sessionReplayDisabled =
  replayConfig.enabled === false ||
  dataContext.sessionReplayDisabled === "" ||
  dataContext.sessionReplayDisabled === "true";

if (!sessionReplayDisabled) {
  sessionReplayPlugin({
    ingestorHost:
      windowContext.eventIngestorHost || dataContext.eventIngestorHost,
    enabled: replayConfig.enabled,
    privacy: replayConfig.privacy,
  })(gb);
}

export default gb;
