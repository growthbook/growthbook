import Agenda from "agenda";
import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";
import { getBackendFeatureValue } from "back-end/src/services/growthbook";
import { logger } from "back-end/src/util/logger";

// Upkeep for apikeys: idempotent steps, each gated on a flag read per run so it switches without a redeploy.
const JOB_NAME = "apiKeyMaintenance";
const HASH_BATCH_SIZE = 1000;

const apiKeyMaintenance = async () => {
  // Off until every task can look keys up by hash, so a rollout or rollback never meets a key it can't match.
  if (getBackendFeatureValue("api-key-hash-plaintext-secrets", false)) {
    const hashed =
      await ApiKeyModel.dangerousHashPlaintextSecrets(HASH_BATCH_SIZE);
    if (hashed) logger.info({ hashed }, "Hashed plaintext API key secrets");
  }
};

export default async function addApiKeyMaintenanceJob(agenda: Agenda) {
  agenda.define(JOB_NAME, apiKeyMaintenance);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("1 hour");
  await job.save();
}
