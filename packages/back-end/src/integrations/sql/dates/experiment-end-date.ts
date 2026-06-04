import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";

export function getExperimentEndDate(
  settings: ExperimentSnapshotSettings,
  conversionWindowHours: number,
  // Reference "now" for the conversion-window cutoff. Defaults to the current
  // time, but callers (e.g. incremental refresh) pass a pinned timestamp so the
  // cutoff is deterministic across the many queries in a run and matches the
  // freshness of materialized caches.
  now: Date = new Date(),
): Date {
  // Only include users who entered the experiment before this timestamp
  // If we need to wait until users have had a chance to fully convert
  if (settings.skipPartialData) {
    // The last date allowed to give enough time for users to convert
    const conversionWindowEndDate = new Date(now);
    conversionWindowEndDate.setHours(
      conversionWindowEndDate.getHours() - conversionWindowHours,
    );

    // Use the earliest of either the conversion end date or the phase end date
    return new Date(
      Math.min(settings.endDate.getTime(), conversionWindowEndDate.getTime()),
    );
  }

  // Otherwise, use the actual end date
  return settings.endDate;
}
