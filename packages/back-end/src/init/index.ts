import { licenseInit } from "enterprise";
import { logger } from "../util/logger";
import { IS_CLOUD } from "../util/secrets";
import { getUserLicenseCodes } from "../services/users";
import mongoInit from "./mongo";
import { queueInit } from "./queue";

let initPromise: Promise<void>;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await mongoInit();
      await queueInit();
      const allUserLicenseCodes = IS_CLOUD ? [] : await getUserLicenseCodes();
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
