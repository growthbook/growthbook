import Agenda from "agenda";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { getCollection } from "back-end/src/util/mongo.util";
import { syncCloudSDKMappings } from "back-end/src/services/licenseServerManagedClickhouse";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "syncSdkKeyMappings";
// The license server caps a batch at 1000 rows.
export const BATCH_SIZE = 500;

type MappingDoc = { key?: unknown; organization?: unknown };

/**
 * Re-post every SDK connection's key -> org pair to the license server so
 * usage.sdk_key_mapping heals from any create-time insert that failed.
 * Returns false when the sweep stopped early.
 */
export async function syncSdkKeyMappings(
  source: AsyncIterable<MappingDoc> = getCollection<MappingDoc>(
    "sdkconnections",
  ).find({}, { projection: { key: 1, organization: 1, _id: 0 } }),
): Promise<boolean> {
  const start = Date.now();
  let batch: { key: string; organization: string }[] = [];
  let sent = 0;

  const flush = async () => {
    if (!batch.length) return;
    await syncCloudSDKMappings(batch);
    sent += batch.length;
    batch = [];
  };

  try {
    for await (const doc of source) {
      if (
        typeof doc.key !== "string" ||
        !doc.key ||
        typeof doc.organization !== "string" ||
        !doc.organization
      ) {
        continue;
      }
      batch.push({ key: doc.key, organization: doc.organization });
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();
  } catch (e) {
    // The next run is a full re-sync anyway; a hung license server must not
    // turn this into hours of sequential timeouts.
    logger.error(
      e,
      `${JOB_NAME}: stopped after ${sent} mappings; batch of ${batch.length} failed`,
    );
    return false;
  }

  logger.info(
    `${JOB_NAME}: synced ${sent} SDK key mappings in ${Date.now() - start}ms`,
  );
  return true;
}

export default async function (agenda: Agenda) {
  if (!IS_CLOUD) return;
  agenda.define(JOB_NAME, () => syncSdkKeyMappings());

  // Saving resets nextRunAt, so this also runs once on every process boot.
  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("24 hours");
  await job.save();
}
