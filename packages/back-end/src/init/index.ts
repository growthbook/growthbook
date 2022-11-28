import mongoInit from "./mongo";
import licenseInit from "./license";
import { queueInit } from "./queue";
import { logger } from "../util/logger";
import { initializeEventEmitters } from "./event-emitters";

let initPromise: Promise<void>;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await mongoInit();
      await queueInit();
      await licenseInit();
      initializeEventEmitters();
    })();
  }
  try {
    await initPromise;
  } catch (err) {
    logger.error(err, "Failed to initialize application");
    process.exit(1);
  }
}
