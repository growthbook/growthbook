import { Histogram, metrics, UpDownCounter } from "@opentelemetry/api";
import { logger } from "../util/logger";

const getMeter = (name: string) => {
  return metrics.getMeter(name);
};

const getCounter = (name: string) => {
  return getMeter(name).createCounter(name);
};

const getUpDownCounter = (name: string) => {
  return getMeter(name).createUpDownCounter(name);
};

const getHistogram = (name: string) => {
  return getMeter(name).createHistogram(name);
};

const normalizeJobName = (jobName: string) => jobName.replace(/\s/g, "_");

export const trackJob = (
  jobNameRaw: string,
  fn: (...args: unknown[]) => Promise<unknown>
) => async (...args: unknown[]) => {
  let counter: UpDownCounter;
  let histogram: Histogram;
  let hasMetricsStarted = false;

  const jobName = normalizeJobName(jobNameRaw);

  const startTime = new Date().getTime();

  // init metrics
  try {
    counter = getUpDownCounter(`jobs.${jobName}.running_count`);
    counter.add(1);
    hasMetricsStarted = true;
  } catch (e) {
    logger.error(`error init'ing counter for job: ${jobName}: ${e}`);
  }
  try {
    histogram = getHistogram(`jobs.${jobName}.duration`);
  } catch (e) {
    logger.error(`error init'ing histogram for job: ${jobName}: ${e}`);
  }

  // wrap up metrics function, to be called at the end of the job
  const wrapUpMetrics = () => {
    if (!hasMetricsStarted) return;
    try {
      counter.add(-1);
    } catch (e) {
      logger.error(`error decrementing count metric for job: ${jobName}: ${e}`);
    }
    try {
      histogram?.record(new Date().getTime() - startTime);
    } catch (e) {
      logger.error(`error recording duration metric for job: ${jobName}: ${e}`);
    }
  };

  // run job
  let res;
  try {
    res = await fn(...args);
  } catch (e) {
    logger.error(`error running job: ${jobName}: ${e}`);
    try {
      wrapUpMetrics();
      getCounter(`jobs.${jobName}.errors`).add(1);
    } catch (e) {
      logger.error(`error wrapping up metrics: ${jobName}: ${e}`);
    }
    throw e;
  }

  // on successful job
  try {
    wrapUpMetrics();
    getCounter(`jobs.${jobName}.successes`).add(1);
  } catch (e) {
    logger.error(`error wrapping up metrics: ${jobName}: ${e}`);
  }

  return res;
};
