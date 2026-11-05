import type {
  ExperimentInterface,
  ExperimentNotification,
} from "shared/types/experiment";

export function getExperimentReminderResets(
  previous: ExperimentInterface,
  current: ExperimentInterface,
): ExperimentNotification[] {
  if (previous.status !== current.status) return ["ending-soon", "stale"];
  const previousEnd = previous.statusUpdateSchedule?.stopAt;
  const currentEnd = current.statusUpdateSchedule?.stopAt;
  if (
    (previousEnd ? new Date(previousEnd).getTime() : null) !==
    (currentEnd ? new Date(currentEnd).getTime() : null)
  )
    return ["ending-soon"];
  return [];
}
