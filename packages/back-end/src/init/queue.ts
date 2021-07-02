import Agenda from "agenda";
import mongoose from "mongoose";
import addExperimentResultsJob from "../jobs/updateExperimentResults";
import addWebhooksJob from "../jobs/webhooks";

let agenda: Agenda;
export async function queueInit() {
  agenda = new Agenda({
    mongo: mongoose.connection.db,
  });

  addExperimentResultsJob(agenda);
  addWebhooksJob(agenda);

  await agenda.start();
}
