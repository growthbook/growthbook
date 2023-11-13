import { licenseInit } from "enterprise";
import { logger } from "../util/logger";
import mongoInit from "./mongo";
import { queueInit } from "./queue";
import { IS_CLOUD } from "../util/secrets";
import { getAllUserLicenseCodes } from "../services/users";

let initPromise: Promise<void>;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await mongoInit();
      await queueInit();
      const allUserLicenseCodes = IS_CLOUD
        ? []
        : await getAllUserLicenseCodes();
      await licenseInit(allUserLicenseCodes);
    })();
  }
  try {
    await initPromise;
  } catch (err) {
    logger.error(err, "Failed to initialize application");
    process.exit(1);
  }
}
