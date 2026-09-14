import type { ExperimentStartedNotificationPayload } from "shared/validators";

export function getExperimentStartedSummary(
  data: ExperimentStartedNotificationPayload,
): string {
  const counts: [number, string, string][] = [
    [
      data.linkedFeatureCount ?? 0,
      "linked Feature Flag",
      "linked Feature Flags",
    ],
    [
      data.visualChangesetCount ?? 0,
      "Visual Editor change",
      "Visual Editor changes",
    ],
    [data.urlRedirectCount ?? 0, "URL redirect", "URL redirects"],
  ];
  const details = counts
    .filter(([count]) => count > 0)
    .map(
      ([count, singular, plural]) =>
        `${count} ${count === 1 ? singular : plural}`,
    );
  return details.length ? `Started with ${details.join(", ")}.` : "Started.";
}

const MAX_GOAL_METRIC_NAMES = 3;

// "Goal metrics: A, B, C (+2 more)" — undefined when the payload has none.
export function getExperimentStartedGoalMetricsLine(
  data: ExperimentStartedNotificationPayload,
): string | undefined {
  const names = data.goalMetricNames ?? [];
  if (!names.length) return undefined;
  const shown = names.slice(0, MAX_GOAL_METRIC_NAMES).join(", ");
  const extra = names.length - MAX_GOAL_METRIC_NAMES;
  const label = names.length === 1 ? "Goal metric" : "Goal metrics";
  return `${label}: ${shown}${extra > 0 ? ` (+${extra} more)` : ""}`;
}
