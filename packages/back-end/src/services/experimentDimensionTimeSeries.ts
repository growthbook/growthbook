import { isEqual } from "lodash";
import {
  expandAllSliceMetricsInMap,
  getTimeSeriesAnalysisSettings,
  getTimeSeriesBaseAnalysis,
  isDimensionPrecomputed,
} from "shared/experiments";
import { isDefined } from "shared/util";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { createSnapshotAnalysesBatched } from "back-end/src/services/experiments";

/**
 * Returns the relative/absolute/scaled time series analyses for `dimensionId`,
 * handling both precomputed dimensions and precomputed unit dimensions.
 */
export async function getOrCreatePrecomputedDimensionTimeSeriesAnalyses(
  context: ReqContext | ApiReqContext,
  {
    experiment,
    snapshot,
    dimensionId,
  }: {
    experiment: ExperimentInterface;
    snapshot: ExperimentSnapshotInterface;
    dimensionId: string;
  },
): Promise<ExperimentSnapshotAnalysis[]> {
  if (
    !isDimensionPrecomputed(
      dimensionId,
      snapshot.settings.precomputedUnitDimensionIds ?? [],
    )
  ) {
    throw new Error("Dimension is not precomputed");
  }

  const baseAnalysis = getTimeSeriesBaseAnalysis({
    analyses: snapshot.analyses,
  });
  if (!baseAnalysis) {
    throw new Error(
      "Snapshot missing time series base analysis for precomputed dimension",
    );
  }

  const allAnalysisSettings = getTimeSeriesAnalysisSettings({
    baseSettings: baseAnalysis.settings,
    dimensionId,
  });

  // NB: safe guard but this should never happen as this is called
  // immediately after the base analysis is created
  const analyses = allAnalysisSettings.map((analysisSettings) =>
    snapshot.analyses.find((analysis) =>
      isEqual(analysis.settings, analysisSettings),
    ),
  );
  const missingAnalysisSettings = allAnalysisSettings.filter(
    (_, i) => !analyses[i],
  );
  if (missingAnalysisSettings.length === 0) {
    return analyses.filter(isDefined);
  }

  const metricGroups = await context.models.metricGroups.getAll();
  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);

  expandAllSliceMetricsInMap({
    metricMap,
    factTableMap,
    experiment,
    metricGroups,
  });

  const createdAnalyses = await createSnapshotAnalysesBatched(context, {
    experiment,
    snapshot,
    metricMap,
    analysisSettingsList: missingAnalysisSettings,
  });

  return allAnalysisSettings
    .map(
      (analysisSettings, i) =>
        analyses[i] ??
        createdAnalyses.find((analysis) =>
          isEqual(analysis.settings, analysisSettings),
        ),
    )
    .filter(isDefined);
}
