import { Job, JobAttributesData } from "agenda";
import { logger } from "back-end/src/util/logger";
import { metrics, Counter, Histogram } from "back-end/src/util/metrics";

// Datadog downcases tag values, so it is best to use snake case
const normalizeJobName = (jobName: string) => {
  return jobName
    .replace(/\s/g, "_")
    .replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1_$2")
    .toLowerCase();
};

export const trackJob = <T extends JobAttributesData>(
  jobNameRaw: string,
  fn: (job: Job<T>) => Promise<void>
) => async (job: Job<T>) => {
  let counter: Counter;
  let histogram: Histogram;
  let hasMetricsStarted = false;

  const jobName = normalizeJobName(jobNameRaw);

  // DataDog downcases tag names, so converting to snakecase here
  const attributes = { job_name: jobName };

  const startTime = new Date().getTime();

  // init metrics
  try {
    counter = metrics.getCounter(`jobs.running_count`);
    counter.increment(attributes);
    hasMetricsStarted = true;
  } catch (e) {
    logger.error(
      { err: e, job: job.attrs },
      `Error initializing counter for job`
    );
  }
  try {
    histogram = metrics.getHistogram(`jobs.duration`);
  } catch (e) {
    logger.error(
      { err: e, job: job.attrs },
      `Error initializing histogram for job`
    );
  }

  // wrap up metrics function, to be called at the end of the job
  const wrapUpMetrics = () => {
    try {
      histogram?.record(new Date().getTime() - startTime, attributes);
    } catch (e) {
      logger.error(
        { err: e, job: job.attrs },
        `Error recording duration metric for job`
      );
    }
    if (!hasMetricsStarted) return;
    try {
      counter.decrement(attributes);
    } catch (e) {
      logger.error(
        { err: e, job: job.attrs },
        `Error decrementing count metric for job`
      );
    }
  };

  // run job
  let res;
  try {
    logger.info({ job: job.attrs }, `Starting job ${jobName}`);
    res = await fn(job);
  } catch (e) {
    logger.error({ err: e, job: job.attrs }, `Error running job: ${jobName}`);
    try {
      wrapUpMetrics();
      metrics.getCounter(`jobs.errors`).increment(attributes);
    } catch (e) {
      logger.error(
        { err: e, job: job.attrs },
        `Error wrapping up metrics: ${jobName}`
      );
    }
    throw e;
  }

  // on successful job
  logger.info({ job: job.attrs }, `Successfully finished job ${jobName}`);
  try {
    wrapUpMetrics();
    metrics.getCounter(`jobs.successes`).increment(attributes);
  } catch (e) {
    logger.error(
      { err: e, job: job.attrs },
      `Error wrapping up metrics: ${jobName}`
    );
  }

  return res;
};
