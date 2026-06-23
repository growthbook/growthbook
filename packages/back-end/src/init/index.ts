import { logger } from "back-end/src/util/logger";
import mongoInit from "./mongo";
import { queueInit } from "./queue";
import { uploadsInit } from "./uploads";

let initPromise: Promise<void>;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await mongoInit();
      await queueInit();
      await uploadsInit();
    })();
  }
  try {
    await initPromise;
  } catch (err) {
    logger.error(err, "Failed to initialize application");
    process.exit(1);
  }
}
