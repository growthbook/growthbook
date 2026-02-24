import { logger } from "back-end/src/util/logger";
import { initFormatMetrics } from "./formatMetrics";
import mongoInit from "./mongo";
import { queueInit } from "./queue";

// Set up SQL format metrics (polyglot vs sql-formatter) for Datadog/OpenTelemetry
initFormatMetrics();

let initPromise: Promise<void>;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await mongoInit();
      await queueInit();
    })();
  }
  try {
    await initPromise;
  } catch (err) {
    logger.error(err, "Failed to initialize application");
    process.exit(1);
  }
}
