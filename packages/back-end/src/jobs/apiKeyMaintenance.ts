import Agenda from "agenda";
import { ApiKeyInterface } from "shared/types/apikey";
import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";
import {
  dangerousCreateLegacySDKConnection,
  dangerousDeleteSDKConnectionById,
  findSDKConnectionByKey,
} from "back-end/src/models/SdkConnectionModel";
import { logger } from "back-end/src/util/logger";

// Idempotent upkeep for apikeys, run on every install, so steps can't depend on a feature flag.
const JOB_NAME = "apiKeyMaintenance";
const HASH_BATCH_SIZE = 1000;
const LEGACY_SDK_KEY_BATCH_SIZE = 1000;

const moveLegacySdkKey = async (apiKey: ApiKeyInterface) => {
  // An earlier run may have created the connection but not deleted the key.
  const created = (await findSDKConnectionByKey(apiKey.key))
    ? null
    : await dangerousCreateLegacySDKConnection(apiKey);
  const deleted = await ApiKeyModel.dangerousDeleteLegacySdkKey(apiKey.key);
  // The key was deleted while it was being moved.
  if (!deleted && created) await dangerousDeleteSDKConnectionById(created.id);
};

const apiKeyMaintenance = async () => {
  const hashed =
    await ApiKeyModel.dangerousHashPlaintextSecrets(HASH_BATCH_SIZE);
  if (hashed) logger.info({ hashed }, "Hashed plaintext API key secrets");

  const legacyKeys = await ApiKeyModel.dangerousFindLegacySdkKeys(
    LEGACY_SDK_KEY_BATCH_SIZE,
  );
  let moved = 0;
  for (const apiKey of legacyKeys) {
    try {
      await moveLegacySdkKey(apiKey);
      moved++;
    } catch (err) {
      logger.error(
        { err, apiKeyId: apiKey.id },
        "Failed to move legacy SDK key to sdkconnections",
      );
    }
  }
  if (moved) logger.info({ moved }, "Moved legacy SDK keys to sdkconnections");
};

export default async function addApiKeyMaintenanceJob(agenda: Agenda) {
  agenda.define(JOB_NAME, apiKeyMaintenance);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("1 hour");
  await job.save();
}
