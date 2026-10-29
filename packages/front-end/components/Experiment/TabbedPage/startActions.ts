import { format } from "date-fns-tz";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { hasPendingScheduledStart } from "shared/util";
import type { ApiErrorDetails } from "shared/validators";
import { scheduleToStartLabel } from "@/components/Reviews/reviewAndPublishState";

type StartSchedule = "none" | "future" | "past";

export function getStartSchedule(
  scheduledStartAt: Date | null,
  now: Date,
): StartSchedule {
  if (!scheduledStartAt) return "none";
  return scheduledStartAt > now ? "future" : "past";
}

/**
 * What starting does: start now, or approve a future start. A button label in
 * sentence case, or with `heading`, the popover's Title Case heading.
 */
export function getStartTitle(
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "type" | "statusUpdateSchedule" | "nextScheduledStatusUpdate"
  >,
  now: Date,
  heading = false,
): string {
  const startAt = experiment.statusUpdateSchedule?.startAt;
  const startApproved = hasPendingScheduledStart(experiment);
  if (
    !startApproved &&
    getStartSchedule(startAt ? new Date(startAt) : null, now) === "future"
  ) {
    return heading ? "Schedule Start" : "Schedule start";
  }
  // Bandit is a named resource; experiment is a common noun.
  if (experiment.type === "multi-armed-bandit") return "Start Bandit";
  return heading ? "Start Experiment" : "Start experiment";
}

type StartChecklist = {
  loading: boolean;
  remaining: number;
  blocking: number;
  // The blocking items an admin's bypass waives.
  approval: number;
};

export type ServerChecklistItem =
  ApiErrorDetails<"checklist_incomplete">["remainingChecklistItems"][number];

// Counts the soft items a refused start named, which the page may lack (a
// custom checklist that didn't load); hard items are rows the page builds.
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
  // The bypass here also waives approval, as an admin's does.
  waivesApproval: boolean;
  // Left even after the bypass.
  hardBlocked: boolean;
  // Every must-resolve item is done, without anyone's bypass: the start reads
  // as the next step.
  ready: boolean;
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

// Anyone who can start may skip soft items; an admin who may bypass flag
// approvals may also skip approval. Loading never counts as done.
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
  const waivesApproval = canBypassApproval && checklist.approval > 0;
  const hardBlocked =
    checklist.loading ||
    needsUpgrade ||
    checklist.blocking > (waivesApproval ? checklist.approval : 0);
  const bypassable = !hardBlocked && checklist.remaining > 0;
  return {
    action: futureStart ? "approve-schedule" : "start",
    label: futureStart
      ? scheduleToStartLabel(format(futureStart, "MMM d"))
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
    ready: !hardBlocked && checklist.blocking === 0,
    disabled: hardBlocked || (checklist.remaining > 0 && !bypassed),
  };
}
