import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";

export function getExperimentEndDate(
  settings: Pick<ExperimentSnapshotSettings, "skipPartialData" | "endDate">,
  conversionWindowHours: number,
  // The point in time the data is known-complete up to. Defaults to now, which
  // is correct when the query rescans raw event data. The incremental
  // statistics query passes its cache coverage instead so it never admits a
  // unit whose conversion window extends past the cached data.
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
