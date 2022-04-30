import Agenda, { AgendaConfig } from "agenda";
import mongoose from "mongoose";
import addExperimentResultsJob from "../jobs/updateExperimentResults";
import addWebhooksJob from "../jobs/webhooks";
import addCacheInvalidateJob from "../jobs/cacheInvalidate";
import addMetricUpdateJob from "../jobs/updateMetrics";
import { CRON_ENABLED } from "../util/secrets";

let agenda: Agenda;
export async function queueInit() {
  if (!CRON_ENABLED) return;

  const config: unknown = {
    mongo: mongoose.connection.db,
    defaultLockLimit: 5,
  };
  agenda = new Agenda(config as AgendaConfig);

  addExperimentResultsJob(agenda);
  addMetricUpdateJob(agenda);
  addWebhooksJob(agenda);
  addCacheInvalidateJob(agenda);

  await agenda.start();
}
