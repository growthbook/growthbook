import { format } from "date-fns-tz";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import type { ApiErrorDetails } from "shared/validators";

export type StartSchedule = "none" | "future" | "past";

export function getStartSchedule(
  scheduledStartAt: Date | null,
  now: Date,
): StartSchedule {
  if (!scheduledStartAt) return "none";
  return scheduledStartAt > now ? "future" : "past";
}

/**
 * The review's title, which also labels the buttons that open it: starting a
 * draft, or publishing a running one's value changes.
 */
export function getExperimentReviewTitle(
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "type" | "status" | "statusUpdateSchedule" | "nextScheduledStatusUpdate"
  >,
  now: Date,
): string {
  if (experiment.status !== "draft") return "Review & publish value changes";
  // Bandit is a named resource; experiment is a common noun.
  const noun =
    experiment.type === "multi-armed-bandit" ? "Bandit" : "experiment";
  const startAt = experiment.statusUpdateSchedule?.startAt;
  const startApproved = experiment.nextScheduledStatusUpdate?.type === "start";
  return !startApproved &&
    getStartSchedule(startAt ? new Date(startAt) : null, now) === "future"
    ? `Review & schedule ${noun}`
    : `Review & start ${noun}`;
}

export type StartChecklist = {
  loading: boolean;
  remaining: number;
  blocking: number;
  // The blocking items an admin's bypass waives.
  approval: number;
};

export type ServerChecklistItem =
  ApiErrorDetails<"checklist_incomplete">["remainingChecklistItems"][number];

/**
 * Adds the soft items a refused start named, which the page may lack (a custom
 * checklist that didn't load). Hard items are rows the page builds itself, so
 * its live rows govern.
 */
export function withServerChecklist(
  checklist: StartChecklist,
  serverItems: ServerChecklistItem[],
): StartChecklist {
  return {
    ...checklist,
    remaining:
      checklist.remaining +
      serverItems.filter((item) => !item.hardBlock).length,
  };
}

export type StartActions = {
  // A future schedule is approved now and fires later; anything else starts now.
  action: "start" | "approve-schedule";
  label: string;
  // The one checkbox beside the button, offered once every remaining item is
  // one this viewer may go ahead without.
  bypassLabel: string | null;
  // The bypass here also waives approval and stale values, as an admin's does.
  waivesApproval: boolean;
  // Left even after the bypass.
  hardBlocked: boolean;
  disabled: boolean;
};

function bypassLabel({
  review,
  todo,
  then,
}: {
  review: boolean;
  todo: boolean;
  then: string;
}): string {
  const skipped = [
    review ? "approvals" : null,
    todo ? "remaining To Do items" : null,
  ].filter(Boolean);
  return `Bypass ${skipped.join(" and ")} and ${then}`;
}

/**
 * The start button and its bypass. Anyone who can start may go ahead without
 * a soft item; an admin who may bypass flag approvals also without approval
 * and stale values, but never on a scheduled start. Nothing gets past any
 * other hard blocker, and loading never counts as done.
 */
export function getStartActions({
  scheduledStartAt,
  now,
  checklist,
  canBypassApproval,
  needsUpgrade,
  bypassed,
}: {
  scheduledStartAt: Date | null;
  now: Date;
  checklist: StartChecklist;
  canBypassApproval: boolean;
  needsUpgrade: boolean;
  bypassed: boolean;
}): StartActions {
  const futureStart =
    getStartSchedule(scheduledStartAt, now) === "future"
      ? scheduledStartAt
      : null;
  const waivesApproval =
    !futureStart && canBypassApproval && checklist.approval > 0;
  const hardBlocked =
    checklist.loading ||
    needsUpgrade ||
    checklist.blocking > (waivesApproval ? checklist.approval : 0);
  const bypassable = !hardBlocked && checklist.remaining > 0;
  return {
    action: futureStart ? "approve-schedule" : "start",
    label: futureStart
      ? `Start ${format(futureStart, "MMM d, yyyy 'at' h:mm a")}`
      : "Start now",
    bypassLabel: bypassable
      ? bypassLabel({
          review: waivesApproval,
          todo: checklist.remaining > checklist.blocking,
          then: futureStart ? "schedule start" : "start now",
        })
      : null,
    waivesApproval,
    hardBlocked,
    disabled: hardBlocked || (checklist.remaining > 0 && !bypassed),
  };
}
