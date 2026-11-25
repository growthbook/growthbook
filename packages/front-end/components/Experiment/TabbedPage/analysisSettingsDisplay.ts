import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { date } from "shared/dates";
import { getEffectiveLookbackOverride } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";

export type AnalysisSettingsDisplay = {
  hasData: boolean;
  engine: "Bayesian" | "Frequentist";
  cuped: boolean;
  // Null when the setting doesn't apply, so it isn't shown at all.
  postStratification: boolean | null;
  sequential: boolean | null;
  priorUsed: boolean;
  cupedUsed: boolean;
  postStratificationUsed: boolean;
  lookbackEnforced: string | null;
};

// How the analysis on screen was run, shared by every place that describes it.
export function getAnalysisSettingsDisplay({
  experiment,
  snapshot,
  analysis,
  disablePrecomputedDimensions,
}: {
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "status" | "attributionModel" | "lookbackOverride"
  >;
  snapshot?: Pick<ExperimentSnapshotInterface, "settings"> | null;
  analysis?: Pick<ExperimentSnapshotAnalysis, "settings" | "results"> | null;
  disablePrecomputedDimensions: boolean;
}): AnalysisSettingsDisplay {
  const settings = analysis?.settings;
  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const frequentist = settings?.statsEngine === "frequentist";
  const bayesian =
    (settings?.statsEngine || DEFAULT_STATS_ENGINE) !== "frequentist";
  const cuped = !!settings?.regressionAdjusted;
  const postStratification = disablePrecomputedDimensions
    ? null
    : !!settings?.postStratificationEnabled;

  const lookback = getEffectiveLookbackOverride(
    experiment.attributionModel,
    experiment.lookbackOverride,
  );
  const endDate =
    experiment.status !== "running" ? snapshot?.settings?.endDate : undefined;

  return {
    hasData,
    engine: frequentist ? "Frequentist" : "Bayesian",
    cuped,
    postStratification,
    sequential: frequentist ? !!settings?.sequentialTesting : null,
    priorUsed:
      hasData &&
      bayesian &&
      !!snapshot?.settings?.metricSettings?.some(
        (m) => m.computedSettings?.properPrior,
      ),
    cupedUsed: hasData && cuped,
    postStratificationUsed: hasData && !!postStratification,
    lookbackEnforced: !lookback
      ? null
      : lookback.type === "date"
        ? `${date(lookback.value, "UTC")} - ${endDate ? date(endDate, "UTC") : "now"}`
        : `${lookback.value} ${lookback.valueUnit}`,
  };
}
