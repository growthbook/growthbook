import Agenda, { Job } from "agenda";
import { checkExperimentLifecycleReminders } from "back-end/src/services/experimentLifecycleReminders";

const JOB_NAME = "checkExperimentLifecycleReminders";
const LOCK_LIFETIME = 10 * 60 * 1000;

export default async function addExperimentLifecycleRemindersJob(
  agenda: Agenda,
) {
  agenda.define(
    JOB_NAME,
    { concurrency: 1, lockLimit: 1, lockLifetime: LOCK_LIFETIME },
    async (job: Job) => {
      await checkExperimentLifecycleReminders(async () => {
        const lockedAt = job.attrs.lockedAt;
        const now = new Date();
        if (!lockedAt || now.getTime() - lockedAt.getTime() >= LOCK_LIFETIME) {
          throw new Error("Experiment lifecycle reminder lease expired");
        }
        // Agenda's touch() saves without checking ownership. Compare the prior
        // lock so an expired worker cannot reclaim a job another worker owns.
        const result = await agenda._collection.updateOne(
          { _id: job.attrs._id, lockedAt },
          { $set: { lockedAt: now } },
        );
        if (result.matchedCount !== 1) {
          throw new Error("Experiment lifecycle reminder lease lost");
        }
        job.attrs.lockedAt = now;
      });
    },
  );
  const job = agenda.create(JOB_NAME, {});
  job.unique({ name: JOB_NAME });
  job.repeatEvery("1 hour");
  await job.save();
}
