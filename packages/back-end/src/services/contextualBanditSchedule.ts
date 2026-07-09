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
  const start = (cb.stageDateStarted ?? cb.dateStarted ?? new Date()).getTime();

  if (cb.burnInValue === undefined) {
    throw new Error(
      "Cannot schedule next contextual bandit update. burnInValue is unset.",
    );
  }
  if (cb.burnInUnit === undefined) {
    throw new Error(
      "Cannot schedule next contextual bandit update. burnInUnit is unset.",
    );
  }
  if (cb.scheduleValue === undefined) {
    throw new Error(
      "Cannot schedule next contextual bandit update. scheduleValue is unset.",
    );
  }
  if (cb.scheduleUnit === undefined) {
    throw new Error(
      "Cannot schedule next contextual bandit update. scheduleUnit is unset.",
    );
  }

  const standardHoursMultiple = cb.scheduleUnit === "days" ? 24 : 1;
  const standardInterval = cb.scheduleValue * standardHoursMultiple * HOUR_MS;
  const elapsedTime = Date.now() - start;
  const intervalsPassed = Math.floor(elapsedTime / standardInterval);
  const nextStandardRunDate = new Date(
    start + (intervalsPassed + 1) * standardInterval,
  );

  if (cb.stage === "explore") {
    const burnInHoursMultiple = cb.burnInUnit === "days" ? 24 : 1;
    const burnInRunDate = new Date(
      start + cb.burnInValue * burnInHoursMultiple * HOUR_MS,
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
  const stageStart = cb.stageDateStarted ?? cb.dateStarted ?? now;

  if (cb.stage === "explore") {
    const burnInHoursMultiple = cb.burnInUnit === "days" ? 24 : 1;
    const burnInMs = (cb.burnInValue ?? 0) * burnInHoursMultiple * HOUR_MS;
    if (now.getTime() > stageStart.getTime() + burnInMs) {
      changes.stage = "exploit";
      changes.stageDateStarted = now;
    }
  }

  changes.nextSnapshotAttempt = determineNextContextualBanditSchedule({
    ...cb,
    ...changes,
  });

  return changes;
}
