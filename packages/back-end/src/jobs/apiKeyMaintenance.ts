import Agenda from "agenda";
import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";
import { logger } from "back-end/src/util/logger";

// Idempotent upkeep for apikeys, run on every install, so steps can't depend on a feature flag.
const JOB_NAME = "apiKeyMaintenance";
const HASH_BATCH_SIZE = 1000;

const apiKeyMaintenance = async () => {
  const hashed =
    await ApiKeyModel.dangerousHashPlaintextSecrets(HASH_BATCH_SIZE);
  if (hashed) logger.info({ hashed }, "Hashed plaintext API key secrets");
};

export default async function addApiKeyMaintenanceJob(agenda: Agenda) {
  agenda.define(JOB_NAME, apiKeyMaintenance);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("1 hour");
  await job.save();
}
