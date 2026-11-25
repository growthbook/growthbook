import {
  BAYESIAN_CREDIBLE_INTERVAL_ALPHA,
  DEFAULT_P_VALUE_THRESHOLD,
} from "shared/constants";
import { ExperimentSnapshotAnalysisSettings } from "shared/types/experiment-snapshot";

/**
 * The alpha the stats engine runs an analysis at.
 *
 * In its own file so that enterprise/power, which results/enrich imports, can
 * use it without a circular import.
 */
export function getAnalysisAlpha(
  settings: Pick<
    ExperimentSnapshotAnalysisSettings,
    "statsEngine" | "pValueThreshold"
  >,
): number {
  // The threshold is a frequentist setting; Bayesian intervals stay at 95%.
  return settings.statsEngine === "bayesian"
    ? BAYESIAN_CREDIBLE_INTERVAL_ALPHA
    : Number(settings.pValueThreshold) || DEFAULT_P_VALUE_THRESHOLD;
}
