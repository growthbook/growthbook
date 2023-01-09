import { logger } from "../util/logger";
import mongoInit from "./mongo";
import licenseInit from "./license";
import { queueInit } from "./queue";
import { initSlackIntegration } from "./slack-integration";

let initPromise: Promise<void>;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await mongoInit();
      await queueInit();
      await licenseInit();
      await initSlackIntegration();
    })();
  }
  try {
    await initPromise;
  } catch (err) {
    logger.error(err, "Failed to initialize application");
    process.exit(1);
  }
}
