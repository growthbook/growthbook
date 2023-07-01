import Agenda from "agenda";
import { expireOldQueries } from "../models/QueryModel";

const JOB_NAME = "expireOldQueries";

export default async function (agenda: Agenda) {
  agenda.define(JOB_NAME, async () => {
    await expireOldQueries();
  });

  const job = agenda.create(JOB_NAME, {});
  job.repeatEvery("1 minute");
  await job.save();
}
