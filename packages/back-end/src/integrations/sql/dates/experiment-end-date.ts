import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";

export function getExperimentEndDate(
  settings: Pick<ExperimentSnapshotSettings, "skipPartialData" | "endDate">,
  conversionWindowHours: number,
  // Known-complete data horizon. Defaults to now (rescanning raw
  // events). Incremental stats pass cache coverage instead so a unit whose
  // window extends past the cached data is never admitted.
  asOf: Date = new Date(),
): Date {
  // Only include users who entered the experiment before this timestamp
  // If we need to wait until users have had a chance to fully convert
  if (settings.skipPartialData) {
    // The last date allowed to give enough time for users to convert
    const conversionWindowEndDate = new Date(asOf);
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
