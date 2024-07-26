import { Histogram, metrics, UpDownCounter } from "@opentelemetry/api";
import { logger } from "../util/logger";

export const getMeter = (name: string) => {
  return metrics.getMeter(name);
};

export const getGauge = (name: string) => {
  return getMeter(name).createGauge(name);
};

export const getCounter = (name: string) => {
  return getMeter(name).createCounter(name);
};

export const getUpDownCounter = (name: string) => {
  return getMeter(name).createUpDownCounter(name);
};

export const getHistogram = (name: string) => {
  return getMeter(name).createHistogram(name);
};

// Datadog downcases tag values, so it is best to use snake case
export const normalizeTagName = (tagName: string) => {
  return tagName
    .replace(/\s/g, "_")
    .replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1_$2")
    .toLowerCase();
};

export const trackJob = (
  jobNameRaw: string,
  fn: (...args: unknown[]) => Promise<unknown>
) => async (...args: unknown[]) => {
  let counter: UpDownCounter;
  let histogram: Histogram;
  let hasMetricsStarted = false;

  const jobName = normalizeTagName(jobNameRaw);

  // DataDog downcases tag names, so converting to snakecase here
  const attributes = { job_name: jobName };

  const startTime = new Date().getTime();

  // init metrics
  try {
    counter = getUpDownCounter(`jobs.running_count`);
    counter.add(1, attributes);
    hasMetricsStarted = true;
  } catch (e) {
    logger.error(`error init'ing counter for job: ${jobName}: ${e}`);
  }
  try {
    histogram = getHistogram(`jobs.duration`);
  } catch (e) {
    logger.error(`error init'ing histogram for job: ${jobName}: ${e}`);
  }

  // wrap up metrics function, to be called at the end of the job
  const wrapUpMetrics = () => {
    try {
      histogram?.record(new Date().getTime() - startTime, attributes);
    } catch (e) {
      logger.error(`error recording duration metric for job: ${jobName}: ${e}`);
    }
    if (!hasMetricsStarted) return;
    try {
      counter.add(-1, attributes);
    } catch (e) {
      logger.error(`error decrementing count metric for job: ${jobName}: ${e}`);
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
      getCounter(`jobs.errors`).add(1, attributes);
    } catch (e) {
      logger.error(`error wrapping up metrics: ${jobName}: ${e}`);
    }
    throw e;
  }

  // on successful job
  try {
    wrapUpMetrics();
    getCounter(`jobs.successes`).add(1, attributes);
  } catch (e) {
    logger.error(`error wrapping up metrics: ${jobName}: ${e}`);
  }

  return res;
};
