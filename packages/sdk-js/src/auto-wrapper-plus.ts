// core+sessions bundle: everything in auto-wrapper.ts plus session replay.
// rrweb is inlined (rollup external: () => false), so this stays a single
// self-contained script.
import gb, { dataContext, windowContext } from "./auto-wrapper";
import { sessionReplayPlugin } from "./plugins/session-replay/index";

const CLOUD_INGESTOR_HOST = "__INGESTOR_HOST__";

// Enabled by default; data-session-replay-disabled or
// window.growthbook_config.sessionReplay.enabled = false turns it off
const sessionReplayDisabled =
  windowContext.sessionReplay?.enabled === false ||
  dataContext.sessionReplayDisabled === "" ||
  dataContext.sessionReplayDisabled === "true";

if (!sessionReplayDisabled) {
  sessionReplayPlugin({
    trackingHost:
      dataContext.eventIngestorHost ||
      windowContext.trackingHost ||
      CLOUD_INGESTOR_HOST,
    enabled: windowContext.sessionReplay?.enabled,
    privacy: windowContext.sessionReplay?.privacy,
  })(gb);
}

export default gb;
