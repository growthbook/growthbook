import Agenda, { AgendaConfig } from "agenda";
import mongoose from "mongoose";
import addExperimentResultsJob from "../jobs/updateExperimentResults";
import addWebhooksJob from "../jobs/webhooks";
import addMetricUpdateJob from "../jobs/updateMetrics";

let agenda: Agenda;
export async function queueInit() {
  const config: unknown = {
    mongo: mongoose.connection.db,
    defaultLockLimit: 5,
  };
  agenda = new Agenda(config as AgendaConfig);

  addExperimentResultsJob(agenda);
  addMetricUpdateJob(agenda);
  addWebhooksJob(agenda);

  await agenda.start();
}
