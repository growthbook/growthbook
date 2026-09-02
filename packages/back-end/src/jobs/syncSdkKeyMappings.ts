import Agenda from "agenda";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { getCollection } from "back-end/src/util/mongo.util";
import { syncCloudSDKMappings } from "back-end/src/services/licenseServerManagedClickhouse";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "syncSdkKeyMappings";
export const BATCH_SIZE = 500;

type MappingDoc = { key?: string; organization?: string };

/**
 * Re-post every SDK connection's key -> org pair to the license server so
 * usage.sdk_key_mapping heals from any create-time insert that failed.
 */
export async function syncSdkKeyMappings(
  source: AsyncIterable<MappingDoc> = getCollection<MappingDoc>(
    "sdkconnections",
  ).find({}, { projection: { key: 1, organization: 1, _id: 0 } }),
) {
  if (!IS_CLOUD) return;

  const start = Date.now();
  let batch: { key: string; organization: string }[] = [];
  let sent = 0;
  let failedBatches = 0;

  const flush = async () => {
    if (!batch.length) return;
    try {
      await syncCloudSDKMappings(batch);
      sent += batch.length;
    } catch (e) {
      failedBatches++;
      logger.error(e, `${JOB_NAME}: batch of ${batch.length} mappings failed`);
    }
    batch = [];
  };

  for await (const doc of source) {
    if (!doc.key || !doc.organization) continue;
    batch.push({ key: doc.key, organization: doc.organization });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  logger.info(
    `${JOB_NAME}: synced ${sent} SDK key mappings (${failedBatches} failed batches) in ${Date.now() - start}ms`,
  );
}

export default async function (agenda: Agenda) {
  agenda.define(JOB_NAME, () => syncSdkKeyMappings());

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("24 hours");
  await job.save();
}
