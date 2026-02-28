import { performance } from "node:perf_hooks";
import { Job, JobAttributesData } from "agenda";
import {
  trace,
  context,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import { logger } from "back-end/src/util/logger";
import { metrics, Counter, Histogram } from "back-end/src/util/metrics";

const disableJobLogs = process.env.GB_DISABLE_JOB_LOGS === "1";

// Shared tracer instance for all jobs
const tracer = trace.getTracer("growthbook-jobs");

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
    const jobName = normalizeJobName(jobNameRaw);
    const attributes = { job_name: jobName };
    const startTime = performance.now();

    migrateJobData(job.attrs.data);

    const spanAttributes: Record<string, string> = {
      "job.name": jobNameRaw,
      ...extractJobAttributesForSpan(job.attrs.data),
    };

    let hasMetricsStarted = false;
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
    const wrapUpMetrics = (success: boolean) => {
      try {
        const elapsed = performance.now() - startTime;
        getJobsDurationHistogram().record(elapsed, attributes);
      } catch (e) {
        logger.error(
          { err: e, job: job.attrs },
          `Error recording duration metric for job`,
        );
      }

      if (hasMetricsStarted) {
        try {
          getJobsRunningCounter().decrement(attributes);
        } catch (e) {
          logger.error(
            { err: e, job: job.attrs },
            `Error decrementing jobs.running_count`,
          );
        }
      }

      try {
        if (success) {
          getJobsSuccessesCounter().increment(attributes);
        } else {
          getJobsErrorsCounter().increment(attributes);
        }
      } catch (e) {
        logger.error(
          { err: e, job: job.attrs },
          `Error wrapping up metrics: ${jobName}`,
        );
      }
    };

    return context.with(ROOT_CONTEXT, () =>
      tracer.startActiveSpan(
        `job.${jobNameRaw}`,
        {
          kind: SpanKind.CONSUMER,
          attributes: spanAttributes,
        },
        async (span) => {
          try {
            if (!disableJobLogs) {
              logger.debug({ job: job.attrs }, `Starting job ${jobName}`);
            }

            const result = await fn(job);

            if (!disableJobLogs) {
              logger.debug(
                { job: job.attrs },
                `Successfully finished job ${jobName}`,
              );
            }

            span.setStatus({ code: SpanStatusCode.OK });
            wrapUpMetrics(true);
            return result;
          } catch (error) {
            logger.error(
              { err: error, job: job.attrs },
              `Error running job: ${jobName}`,
            );

            // Attach job.id only on errors so it's available
            // without adding high-cardinality tags to every span
            span.setAttribute("job.id", job.attrs._id?.toString() || "unknown");
            span.recordException(error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message:
                error instanceof Error
                  ? error.message
                  : String(error || "Job failed"),
            });
            wrapUpMetrics(false);
            throw error;
          } finally {
            span.end();
          }
        },
      ),
    );
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

/**
 * We migrated to a canonical organizationId for example, but we
 * want to ensure we are not dropping any old queued jobs when updating.
 * So this handles old field names to the new field names.
 */
const LEGACY_JOB_DATA_FIELDS: Record<string, string> = {
  organization: "organizationId",
  orgId: "organizationId",
};

/**
 * Migrates & normalizes job data to ensure we
 * only need to handle the latest format.
 *
 * NB: It modifies the original data object in place.
 */
function migrateJobData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const [legacy, updated] of Object.entries(LEGACY_JOB_DATA_FIELDS)) {
    if (data[legacy] !== undefined && data[updated] === undefined) {
      data[updated] = data[legacy];
    }
  }
}

/**
 * Extracts contextual attributes from job data for trace spans.
 * Captures any string field ending in "Id" (organizationId, experimentId, etc.)
 */
function extractJobAttributesForSpan(
  data: Record<string, unknown> | undefined,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!data) return attributes;

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && key.toLowerCase().endsWith("id")) {
      const attrName = key.slice(0, -2).toLowerCase() + ".id";
      attributes[attrName] = value;
    }
  }

  return attributes;
}
