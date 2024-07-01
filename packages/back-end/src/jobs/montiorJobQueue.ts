import { getGauge, normalizeTagName, trackJob } from "../services/otel";
import { getAgendaInstance } from "../services/queueing";

const MONITOR_JOB_QUEUE_JOB_NAME = "monitorJobQueue";

const getOverview = async () => {
  const agenda = getAgendaInstance();
  // The following query is borrowed from agendash: https://github.com/agenda/agendash/blob/e86e7f7d3e411c1d61f2975dd2876a17b7205b38/lib/controllers/agendash.js#L125
  const collection = agenda._collection;
  const results = await collection
    .aggregate([
      {
        $group: {
          _id: "$name",
          displayName: { $first: "$name" },
          meta: {
            $addToSet: {
              type: "$type",
              priority: "$priority",
              repeatInterval: "$repeatInterval",
              repeatTimezone: "$repeatTimezone",
            },
          },
          total: { $sum: 1 },
          running: {
            $sum: {
              $cond: [
                {
                  $and: [
                    "$lastRunAt",
                    { $gt: ["$lastRunAt", "$lastFinishedAt"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          scheduled: {
            $sum: {
              $cond: [
                {
                  $and: ["$nextRunAt", { $gte: ["$nextRunAt", new Date()] }],
                },
                1,
                0,
              ],
            },
          },
          queued: {
            $sum: {
              $cond: [
                {
                  $and: [
                    "$nextRunAt",
                    { $gte: [new Date(), "$nextRunAt"] },
                    { $gte: ["$nextRunAt", "$lastFinishedAt"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          completed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    "$lastFinishedAt",
                    { $gt: ["$lastFinishedAt", "$failedAt"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          failed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    "$lastFinishedAt",
                    "$failedAt",
                    { $eq: ["$lastFinishedAt", "$failedAt"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          repeating: {
            $sum: {
              $cond: [
                {
                  $and: ["$repeatInterval", { $ne: ["$repeatInterval", null] }],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ])
    .toArray();
  return results;
};

export default trackJob(MONITOR_JOB_QUEUE_JOB_NAME, async () => {
  const results = await getOverview();
  const total = getGauge("jobs.total");
  const running = getGauge("jobs.running");
  const scheduled = getGauge("jobs.scheduled");
  const queued = getGauge("jobs.queued");
  const completed = getGauge("jobs.completed");
  const failed = getGauge("jobs.failed");
  const repeating = getGauge("jobs.repeating");

  for (const result of results) {
    const jobName = normalizeTagName(result["displayName"]);

    // DataDog downcases tag names, so converting to snakecase here
    const attributes = { job_name: jobName };

    total.record(result["total"], attributes);
    running.record(result["running"], attributes);
    scheduled.record(result["scheduled"], attributes);
    queued.record(result["queued"], attributes);
    completed.record(result["completed"], attributes);
    failed.record(result["failed"], attributes);
    repeating.record(result["repeating"], attributes);
  }
});
