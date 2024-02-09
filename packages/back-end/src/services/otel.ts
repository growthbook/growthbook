import { metrics } from "@opentelemetry/api";
import { logger } from "../util/logger";

const getMeter = (name: string) => {
  return metrics.getMeter(name);
};

const getUpDownCounter = (name: string) => {
  return getMeter(name).createUpDownCounter(name);
};

const getHistogram = (name: string) => {
  return getMeter(name).createHistogram(name);
};

export const trackJob = (
  jobName: string,
  fn: (...args: unknown[]) => Promise<unknown>
) => async (...args: unknown[]) => {
  let counter;
  let histogram;
  const startTime = new Date().getTime();

  try {
    try {
      counter = getUpDownCounter(`jobs.${jobName}.count`);
      histogram = getHistogram(`jobs.${jobName}.duration`);
      counter.add(1);
    } catch (e) {
      logger.error(`error reporting count metric for job: ${jobName} - ${e}`);
    }

    const res = await fn(...args);

    try {
      counter?.add(-1);
    } catch (e) {
      logger.error(`error reporting count metric for job: ${jobName} - ${e}`);
    }

    try {
      histogram?.record(new Date().getTime() - startTime);
    } catch (e) {
      logger.error(`error reporting count metric for job: ${jobName} - ${e}`);
    }

    return res;
  } catch (e) {
    try {
      counter?.add(-1);
      histogram?.record(new Date().getTime() - startTime);
    } catch (e) {
      logger.error(`error reporting metrics for job: ${jobName} - ${e}`);
    }
    throw e;
  }
};
