import Agenda from "agenda";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { logger } from "back-end/src/util/logger";
const JOB_NAME = "deleteOldAgendaJobs";

// Delete old agenda jobs that finished over one week ago and are not going to be repeated
const deleteOldAgendaJobs = async () => {
  const agenda = getAgendaInstance();

  const startDate = Date.now();

  const res = await agenda._collection
    .find(
      {
        lastFinishedAt: { $lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
        nextRunAt: null,
      },
      {
        limit: 1000,
        projection: { _id: 1 },
      },
    )
    .toArray();

  const ids = res.map((r) => r._id);

  const deleteRes = await agenda._collection.deleteMany({ _id: { $in: ids } });

  logger.debug(
    `Deleted ${deleteRes.deletedCount} old agenda jobs in ` +
      (Date.now() - startDate) +
      `ms`,
  );
};

export default async function (agenda: Agenda) {
  agenda.define(JOB_NAME, deleteOldAgendaJobs);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("5 minutes");
  await job.save();
}
