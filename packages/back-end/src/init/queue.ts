import Agenda, { AgendaConfig } from "agenda";
import mongoose from "mongoose";
import addExperimentResultsJob from "../jobs/updateExperimentResults";
import addWebhooksJob from "../jobs/webhooks";

let agenda: Agenda;
export async function queueInit() {
  const config: unknown = {
    mongo: mongoose.connection.db,
    defaultLockLimit: 5,
  };
  agenda = new Agenda(config as AgendaConfig);

  addExperimentResultsJob(agenda);
  addWebhooksJob(agenda);

  await agenda.start();
}
