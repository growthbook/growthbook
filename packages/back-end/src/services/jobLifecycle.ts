import { Job, JobAttributesData } from "agenda";
import { logger } from "back-end/src/util/logger";
import { MAX_QUERY_TIMEOUT_MS } from "back-end/src/util/secrets";

const TOUCH_INTERVAL_MS = 3 * 60 * 1000;
const JOB_TIMEOUT_MS = MAX_QUERY_TIMEOUT_MS + 1000; // Allow some buffer for the query client to close properly after it times out

// As some functions may take a while to run, this will update the job's lock if the process is still running
export const addJobLifecycleChecks = <T extends JobAttributesData>(
  fn: (job: Job<T>) => Promise<void>
) => async (job: Job<T>) => {
  let touchTimer: NodeJS.Timeout | null = null;
  let timeoutTimer: NodeJS.Timeout | null = null;
  let finished = false;

  function startTouch() {
    touchTimer = setInterval(() => {
      if (!finished) {
        job.touch().catch((e) => {
          logger.error(e, `Failed to touch Agenda job ${job.attrs.name}`);
        });
      }
    }, TOUCH_INTERVAL_MS);
  }

  function stopTouch() {
    finished = true;
    if (touchTimer) clearInterval(touchTimer);
  }

  startTouch();

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      const errorMsg = `Agenda job timed out after ${JOB_TIMEOUT_MS}ms: ${job.attrs.name}`;

      stopTouch();
      logger.error(new Error(errorMsg));
      reject(new Error(errorMsg));
    }, JOB_TIMEOUT_MS);
  });

  try {
    // NB: This does not mean the job will stop executing, if it has side effects it will still happen
    // But we will mark it as failed and log an error
    await Promise.race([fn(job), timeoutPromise]);
  } finally {
    stopTouch();
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }
};
