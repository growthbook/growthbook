import { logger } from "../util/logger";
import mongoInit from "./mongo";
import { queueInit } from "./queue";
import { initializeLicense } from "../services/licenseData";

let initPromise: Promise<void>;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await mongoInit();
      await queueInit();
      await initializeLicense();
    })();
  }
  try {
    await initPromise;
  } catch (err) {
    logger.error(err, "Failed to initialize application");
    process.exit(1);
  }
}
