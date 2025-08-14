import { Job, JobAttributesData } from "agenda";
import { logger } from "back-end/src/util/logger";
import { JOB_TIMEOUT_MS } from "back-end/src/util/secrets";

const TOUCH_INTERVAL_MS = 9 * 60 * 1000;

//This prevents the lockLifetime being reached as long as the job is running, and hence stops other servers from picking up the job.
//This also adds a timeout which allows the job to keep running but marks it as failed, which frees up the "slot" for another job to run, in case the defaultLockLimit is reached, and also prevents other jobs from picking it up unless they have retry logic.
export const addJobLifecycleChecks =
  <T extends JobAttributesData>(fn: (job: Job<T>) => Promise<void>) =>
  async (job: Job<T>) => {
    let touchTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let finished = false;

    function startTouch() {
      touchTimer = setInterval(() => {
        if (!finished) {
          job.touch().catch((e) => {
            logger.error(
              {
                job: job.attrs,
                err: e,
              },
              `Error while trying to touch Agenda job ${job.attrs.name}`,
            );
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
        const errorMsg = `Agenda job ${job.attrs.name} timed out after ${JOB_TIMEOUT_MS}ms`;
        const error = new Error(errorMsg);

        stopTouch();
        logger.error({ err: error, job: job.attrs });
        reject(error);
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
