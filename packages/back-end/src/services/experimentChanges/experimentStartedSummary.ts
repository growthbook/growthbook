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
