import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";

export function getExperimentEndDate(
  settings: Pick<ExperimentSnapshotSettings, "skipPartialData" | "endDate">,
  conversionWindowHours: number,
  // For Incremental Exploratory queries, we need to know when the last update
  // for the incremental tables happened, so we ensure that we use the same cutoff
  // data as the overall results did.
  // Otherwise the exploratory could include more units than the overall result
  asOf: Date = new Date(),
): Date {
  // Only include users who entered the experiment before this timestamp
  // If we need to wait until users have had a chance to fully convert
  if (settings.skipPartialData) {
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
