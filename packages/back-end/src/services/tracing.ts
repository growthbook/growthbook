import { performance } from "node:perf_hooks";
import { Job, JobAttributesData } from "agenda";
import { logger } from "back-end/src/util/logger";
import { metrics, Counter, Histogram } from "back-end/src/util/metrics";

const disableJobLogs = process.env.GB_DISABLE_JOB_LOGS === "1";

// Datadog downcases tag values, so it is best to use snake case
const normalizeJobName = (jobName: string) => {
  return jobName
    .replace(/\s/g, "_")
    .replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1_$2")
    .toLowerCase();
};

export const trackJob =
  <T extends JobAttributesData>(
    jobNameRaw: string,
    fn: (job: Job<T>) => Promise<void>,
  ) =>
  async (job: Job<T>) => {
    let hasMetricsStarted = false;

    const jobName = normalizeJobName(jobNameRaw);

    // DataDog downcases tag names, so converting to snakecase here
    const attributes = { job_name: jobName };

    const startTime = performance.now();

    // init metrics
    try {
      getJobsRunningCounter().increment(attributes);
      hasMetricsStarted = true;
    } catch (e) {
      logger.error(
        { err: e, job: job.attrs },
        `Error incrementing jobs.running_count`,
      );
    }

    // wrap up metrics function, to be called at the end of the job
    const wrapUpMetrics = () => {
      try {
        const end = performance.now();
        const elapsed = end - startTime;
        getJobsDurationHistogram().record(elapsed, attributes);
      } catch (e) {
        logger.error(
          { err: e, job: job.attrs },
          `Error recording duration metric for job`,
        );
      }
      if (!hasMetricsStarted) return;
      try {
        getJobsRunningCounter().decrement(attributes);
      } catch (e) {
        logger.error(
          { err: e, job: job.attrs },
          `Error decrementing jobs.running_count`,
        );
      }
    };

    // run job
    let res;
    try {
      if (!disableJobLogs) {
        logger.debug({ job: job.attrs }, `Starting job ${jobName}`);
      }
      res = await fn(job);
    } catch (e) {
      logger.error({ err: e, job: job.attrs }, `Error running job: ${jobName}`);
      try {
        wrapUpMetrics();
        getJobsErrorsCounter().increment(attributes);
      } catch (e) {
        logger.error(
          { err: e, job: job.attrs },
          `Error wrapping up metrics: ${jobName}`,
        );
      }
      throw e;
    }

    // on successful job
    if (!disableJobLogs) {
      logger.debug({ job: job.attrs }, `Successfully finished job ${jobName}`);
    }
    try {
      wrapUpMetrics();
      getJobsSuccessesCounter().increment(attributes);
    } catch (e) {
      logger.error(
        { err: e, job: job.attrs },
        `Error wrapping up metrics: ${jobName}`,
      );
    }

    return res;
  };

// Cache metric handles
let jobsRunningCounter: Counter | null = null;
let jobsDurationHistogram: Histogram | null = null;
let jobsSuccessesCounter: Counter | null = null;
let jobsErrorsCounter: Counter | null = null;

function getJobsRunningCounter() {
  if (!jobsRunningCounter) {
    jobsRunningCounter = metrics.getCounter("jobs.running_count");
  }
  return jobsRunningCounter;
}

function getJobsDurationHistogram() {
  if (!jobsDurationHistogram) {
    jobsDurationHistogram = metrics.getHistogram("jobs.duration");
  }
  return jobsDurationHistogram;
}

function getJobsSuccessesCounter() {
  if (!jobsSuccessesCounter) {
    jobsSuccessesCounter = metrics.getCounter("jobs.successes");
  }
  return jobsSuccessesCounter;
}

function getJobsErrorsCounter() {
  if (!jobsErrorsCounter) {
    jobsErrorsCounter = metrics.getCounter("jobs.errors");
  }
  return jobsErrorsCounter;
}
