import type { ExperimentStartedNotificationPayload } from "shared/validators";

const MAX_GOAL_METRIC_NAMES = 3;

// "2 Feature Flags, 1 Visual Editor change, 1 URL redirect" — undefined when
// the experiment launched with no linked changes.
export function getExperimentStartedLinkedChanges(
  data: ExperimentStartedNotificationPayload,
): string | undefined {
  const counts: [number, string, string][] = [
    [data.linkedFeatureCount ?? 0, "Feature Flag", "Feature Flags"],
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
  return details.length ? details.join(", ") : undefined;
}

// Up to three goal metric names with a "(+N more)" tail.
export function getExperimentStartedGoalMetrics(
  data: ExperimentStartedNotificationPayload,
): { label: string; value: string } | undefined {
  const names = data.goalMetricNames ?? [];
  if (!names.length) return undefined;
  const shown = names.slice(0, MAX_GOAL_METRIC_NAMES).join(", ");
  const extra = names.length - MAX_GOAL_METRIC_NAMES;
  return {
    label: names.length === 1 ? "Goal metric" : "Goal metrics",
    value: `${shown}${extra > 0 ? ` (+${extra} more)` : ""}`,
  };
}

// Label/value pairs for the started card body.
export function getExperimentStartedFields(
  data: ExperimentStartedNotificationPayload,
): { label: string; value: string }[] {
  const goalMetrics = getExperimentStartedGoalMetrics(data);
  const linkedChanges = getExperimentStartedLinkedChanges(data);
  return [
    ...(goalMetrics ? [goalMetrics] : []),
    ...(linkedChanges
      ? [{ label: "Linked changes", value: linkedChanges }]
      : []),
  ];
}

// Sentence form for text channels (Slack, email).
export function getExperimentStartedSummary(
  data: ExperimentStartedNotificationPayload,
): string {
  const linkedChanges = getExperimentStartedLinkedChanges(data);
  return linkedChanges ? `Started with ${linkedChanges}.` : "Started.";
}

// "Goal metrics: A, B, C (+2 more)" for text channels.
export function getExperimentStartedGoalMetricsLine(
  data: ExperimentStartedNotificationPayload,
): string | undefined {
  const goalMetrics = getExperimentStartedGoalMetrics(data);
  return goalMetrics ? `${goalMetrics.label}: ${goalMetrics.value}` : undefined;
}
