import Agenda from "agenda";
import { trackJob } from "../services/otel";
import { getAgendaInstance } from "../services/queueing";
import { logger } from "../util/logger";
const JOB_NAME = "deleteOldAgendaJobs";

const deleteOldAgendaJobs = trackJob(JOB_NAME, async () => {
  // Delete old agenda jobs that finished over 24 hours ago and are not going to be repeated
  const agenda = getAgendaInstance();

  const numDeleted = await agenda.cancel({
    lastFinishedAt: { $lt: new Date(Date.now() - 24 * 3600 * 1000) },
    nextRunAt: null,
  });

  logger.info(`Deleted ${numDeleted} old agenda jobs`);
});

export default async function (agenda: Agenda) {
  agenda.define(JOB_NAME, deleteOldAgendaJobs);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("1 day");
  await job.save();
}
