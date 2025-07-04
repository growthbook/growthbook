import Agenda from "agenda";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { trackJob } from "back-end/src/services/tracing";
import { logger } from "back-end/src/util/logger";
import { Gauge, metrics } from "back-end/src/util/metrics";

const MONITOR_JOB_QUEUE_NAME = "monitorJobQueue";

const addMonitorJobQueueJob = trackJob(MONITOR_JOB_QUEUE_NAME, async () => {
  const agenda = getAgendaInstance();

  const now = new Date();

  try {
    // Query the AgendaJobs collection
    const jobsCollection = agenda._collection;

    // Find jobs waiting to be run ASAP (nextRunAt <= now and lockedAt is null)
    const waitingJobs = await jobsCollection
      .find({
        nextRunAt: { $lte: now }, // Jobs that should have already started
        lockedAt: null, // Jobs that are not locked yet
      })
      .toArray();

    const waitingCount = waitingJobs.length;

    // Calculate the average waiting time
    const totalWaitingTime = waitingJobs.reduce((sum, job) => {
      const waitingTime = now.getTime() - new Date(job.nextRunAt).getTime();
      return sum + waitingTime;
    }, 0);

    const averageWaitingTime =
      waitingCount > 0 ? totalWaitingTime / waitingCount : 0;

    const waitingGauge: Gauge = metrics.getGauge("jobs.waiting_count");
    const averageWaitingTimeGauge: Gauge = metrics.getGauge(
      "jobs.average_waiting_time"
    );

    // Post metrics to Datadog
    waitingGauge.record(waitingCount, {
      job_name: MONITOR_JOB_QUEUE_NAME,
    });
    averageWaitingTimeGauge.record(averageWaitingTime, {
      job_name: MONITOR_JOB_QUEUE_NAME,
    });
  } catch (error) {
    logger.error("Error monitoring job queue:", error);
  }
});

export default async function (agenda: Agenda) {
  agenda.define(MONITOR_JOB_QUEUE_NAME, addMonitorJobQueueJob);

  const job = agenda.create(MONITOR_JOB_QUEUE_NAME, {});
  job.unique({});
  job.repeatEvery("10 seconds");
  await job.save();
}
