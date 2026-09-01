import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";

export function getExperimentEndDate(
  settings: Pick<ExperimentSnapshotSettings, "skipPartialData" | "endDate">,
  conversionWindowHours: number,
  // Known-complete data horizon. Defaults to now (rescanning raw
  // events). Incremental exploratory passes the last overall snapshot's
  // dateCreated so a unit whose window extends past the cached data is
  // never admitted.
  asOf: Date = new Date(),
): Date {
  // Only include users who entered the experiment before this timestamp
  // If we need to wait until users have had a chance to fully convert
  if (settings.skipPartialData) {
    // Elapsed time, not setHours: sub-hour windows (1 minute, 30 minutes)
    // are first-class in the UI and API, and setHours integer-truncates.
    const conversionWindowEndDate = new Date(
      asOf.getTime() - conversionWindowHours * 3600 * 1000,
    );

    // Use the earliest of either the conversion end date or the phase end date
    return new Date(
      Math.min(settings.endDate.getTime(), conversionWindowEndDate.getTime()),
    );
  }

  // Otherwise, use the actual end date
  return settings.endDate;
}
