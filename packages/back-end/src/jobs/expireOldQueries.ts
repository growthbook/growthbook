import Agenda from "agenda";
import { getStaleQueries } from "../models/QueryModel";

const JOB_NAME = "expireOldQueries";

export default async function (agenda: Agenda) {
  agenda.define(JOB_NAME, async () => {
    const queries = await getStaleQueries();

    // TODO: look for models that are "running" and referencing the stale queries
    // TODO: update the models to mark them as failed
    return queries;
  });

  const job = agenda.create(JOB_NAME, {});
  job.repeatEvery("1 minute");
  await job.save();
}
