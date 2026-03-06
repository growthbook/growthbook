import { logger } from "back-end/src/util/logger";
import { initFormatMetrics } from "./formatMetrics";
import mongoInit from "./mongo";
import { queueInit } from "./queue";

let initPromise: Promise<void>;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await mongoInit();
      await queueInit();
      // Set up SQL format metrics and init polyglot WASM before accepting requests
      await initFormatMetrics();
    })();
  }
  try {
    await initPromise;
  } catch (err) {
    logger.error(err, "Failed to initialize application");
    process.exit(1);
  }
}
