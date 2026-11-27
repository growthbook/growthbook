import { logger } from "back-end/src/util/logger";
import { ensureDefinitionsVersionIndex } from "back-end/src/models/DefinitionsVersionModel";
import { backfillAutoExperimentSettings } from "back-end/src/services/autoExperimentsBackfill";
import { IS_CLOUD } from "back-end/src/util/secrets";
import mongoInit from "./mongo";
import { queueInit } from "./queue";

let initPromise: Promise<void>;
export async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await mongoInit();
      // Before queueInit: agenda jobs can bump the definitions version, and
      // concurrent first-touch upserts without the unique index would create
      // duplicate per-org docs (breaking this index's creation on the next boot).
      await ensureDefinitionsVersionIndex();
      // Cloud runs this from the super admin page instead. A failure leaves organizations
      // on what they had before, so it must not stop the server.
      if (!IS_CLOUD) {
        try {
          await backfillAutoExperimentSettings();
        } catch (e) {
          logger.error(e, "Failed to backfill auto experiment settings");
        }
      }
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
