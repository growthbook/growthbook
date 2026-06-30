import { isEqual } from "lodash";
import {
  expandAllSliceMetricsInMap,
  isDimensionPrecomputed,
} from "shared/experiments";
import { isDefined } from "shared/util";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { createSnapshotAnalysesBatched } from "back-end/src/services/experiments";

export function isDimensionTimeSeriesCompatibleAnalysisSettings({
  settings,
  dimensionId,
}: {
  settings: ExperimentSnapshotAnalysisSettings;
  dimensionId?: string;
}): boolean {
  if ((settings.baselineVariationIndex ?? 0) !== 0) return false;

  const expectedDimensions = dimensionId ? [dimensionId] : [];
  return isEqual(settings.dimensions, expectedDimensions);
}

export function getTimeSeriesAnalysisSettings({
  baseSettings,
  dimensionId,
}: {
  baseSettings: ExperimentSnapshotAnalysisSettings;
  dimensionId?: string;
}): ExperimentSnapshotAnalysisSettings[] {
  return (["relative", "absolute", "scaled"] as const).map(
    (differenceType) => ({
      ...baseSettings,
      dimensions: dimensionId ? [dimensionId] : [],
      differenceType,
    }),
  );
}

export function getTimeSeriesBaseAnalysis({
  analyses,
  dimensionId,
}: {
  analyses: ExperimentSnapshotAnalysis[];
  dimensionId?: string;
}): ExperimentSnapshotAnalysis | undefined {
  const compatibleAnalyses = analyses.filter((analysis) =>
    isDimensionTimeSeriesCompatibleAnalysisSettings({
      settings: analysis.settings,
      dimensionId,
    }),
  );

  return compatibleAnalyses.find(
    (analysis) => analysis.settings.differenceType === "relative",
  );
}

export function getTimeSeriesAnalyses({
  analyses,
  dimensionId,
}: {
  analyses: ExperimentSnapshotAnalysis[];
  dimensionId?: string;
}): ExperimentSnapshotAnalysis[] {
  const baseAnalysis = getTimeSeriesBaseAnalysis({ analyses, dimensionId });
  if (!baseAnalysis) return [];

  const timeSeriesAnalysisSettings = getTimeSeriesAnalysisSettings({
    baseSettings: baseAnalysis.settings,
    dimensionId,
  });

  return timeSeriesAnalysisSettings
    .map((analysisSettings) =>
      analyses.find((analysis) => isEqual(analysis.settings, analysisSettings)),
    )
    .filter(isDefined);
}

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
