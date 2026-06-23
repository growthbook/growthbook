import { ContextualBanditInterface } from "shared/validators";

const HOUR_MS = 60 * 60 * 1000;

export type ContextualBanditUpdate = Partial<
  Omit<
    ContextualBanditInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >
>;

export function determineNextContextualBanditSchedule(
  cb: ContextualBanditInterface,
): Date {
  const start = (
    cb.contextualBanditStageDateStarted ??
    cb.dateStarted ??
    new Date()
  ).getTime();

  if (cb.contextualBanditBurnInValue === undefined) {
    throw new Error(
      "Cannot schedule next contextual bandit update. contextualBanditBurnInValue is unset.",
    );
  }
  if (cb.contextualBanditBurnInUnit === undefined) {
    throw new Error(
      "Cannot schedule next contextual bandit update. contextualBanditBurnInUnit is unset.",
    );
  }
  if (cb.contextualBanditScheduleValue === undefined) {
    throw new Error(
      "Cannot schedule next contextual bandit update. contextualBanditScheduleValue is unset.",
    );
  }
  if (cb.contextualBanditScheduleUnit === undefined) {
    throw new Error(
      "Cannot schedule next contextual bandit update. contextualBanditScheduleUnit is unset.",
    );
  }

  const standardHoursMultiple =
    cb.contextualBanditScheduleUnit === "days" ? 24 : 1;
  const standardInterval =
    cb.contextualBanditScheduleValue * standardHoursMultiple * HOUR_MS;
  const elapsedTime = Date.now() - start;
  const intervalsPassed = Math.floor(elapsedTime / standardInterval);
  const nextStandardRunDate = new Date(
    start + (intervalsPassed + 1) * standardInterval,
  );

  if (cb.contextualBanditStage === "explore") {
    const burnInHoursMultiple =
      cb.contextualBanditBurnInUnit === "days" ? 24 : 1;
    const burnInRunDate = new Date(
      start + cb.contextualBanditBurnInValue * burnInHoursMultiple * HOUR_MS,
    );
    if (burnInRunDate < nextStandardRunDate) {
      return burnInRunDate;
    }
  }

  return nextStandardRunDate;
}

export function computeContextualBanditStageAndSchedule(
  cb: ContextualBanditInterface,
): ContextualBanditUpdate {
  const changes: ContextualBanditUpdate = {};
  const now = new Date();
  const stageStart =
    cb.contextualBanditStageDateStarted ?? cb.dateStarted ?? now;

  if (cb.contextualBanditStage === "explore") {
    const burnInHoursMultiple =
      cb.contextualBanditBurnInUnit === "days" ? 24 : 1;
    const burnInMs =
      (cb.contextualBanditBurnInValue ?? 0) * burnInHoursMultiple * HOUR_MS;
    if (now.getTime() > stageStart.getTime() + burnInMs) {
      changes.contextualBanditStage = "exploit";
      changes.contextualBanditStageDateStarted = now;
    }
  }

  const effectiveStage =
    changes.contextualBanditStage ?? cb.contextualBanditStage;
  if (effectiveStage === "exploit") {
    changes.nextSnapshotAttempt = determineNextContextualBanditSchedule({
      ...cb,
      ...changes,
    });
  }

  return changes;
}
