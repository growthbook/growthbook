import { promisify } from "util";
import { PythonShell } from "python-shell";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
} from "shared/constants";
import { putBaselineVariationFirst } from "shared/util";
import { ExperimentMetricInterface } from "shared/experiments";
import { hoursBetween } from "shared/dates";
import { ExperimentMetricAnalysis } from "../../types/stats";
import {
  ExperimentMetricQueryResponseRows,
  ExperimentResults,
} from "../types/Integration";
import {
  ExperimentReportResultDimension,
  ExperimentReportResults,
} from "../../types/report";
import { promiseAllChunks } from "../util/promise";
import { checkSrm } from "../util/stats";
import { logger } from "../util/logger";
import {
  ExperimentMetricAnalysisParams,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "../../types/experiment-snapshot";
import { QueryMap } from "../queryRunners/QueryRunner";

export const MAX_DIMENSIONS = 20;

export async function analyzeExperimentMetric(
  params: ExperimentMetricAnalysisParams
): Promise<ExperimentMetricAnalysis> {
  const {
    variations,
    metric,
    rows,
    dimension,
    baselineVariationIndex,
    differenceType,
    phaseLengthHours,
    coverage,
    statsEngine,
    sequentialTestingEnabled,
    sequentialTestingTuningParameter,
    pValueThreshold,
  } = params;
  if (!rows || !rows.length) {
    return {
      unknownVariations: [],
      multipleExposures: 0,
      dimensions: [],
    };
  }
  const sortedVariations = putBaselineVariationFirst(
    variations,
    baselineVariationIndex
  );
  const variationIdMap: { [key: string]: number } = {};
  sortedVariations.map((v, i) => {
    variationIdMap[v.id] = i;
  });

  const sequentialTestingTuningParameterNumber =
    Number(sequentialTestingTuningParameter) ||
    DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  const pValueThresholdNumber =
    Number(pValueThreshold) || DEFAULT_P_VALUE_THRESHOLD;
  let differenceTypeString = "DifferenceType.RELATIVE";
  if (differenceType == "absolute") {
    differenceTypeString = "DifferenceType.ABSOLUTE";
  } else if (differenceType == "scaled") {
    differenceTypeString = "DifferenceType.SCALED";
  }
  const phaseLengthDays = Number(phaseLengthHours / 24);
  const result = await promisify(PythonShell.runString)(
    `
from gbstats.gbstats import (
  diff_for_daily_time_series,
  detect_unknown_variations,
  analyze_metric_df,
  get_metric_df,
  reduce_dimensionality,
  format_results
)
from gbstats.shared.constants import DifferenceType, StatsEngine
import pandas as pd
import json

data = json.loads("""${JSON.stringify({
      var_id_map: variationIdMap,
      var_names: sortedVariations.map((v) => v.name),
      weights: sortedVariations.map((v) => v.weight * coverage),
      baseline_index: baselineVariationIndex ?? 0,
      ignore_nulls: "ignoreNulls" in metric && !!metric.ignoreNulls,
      inverse: !!metric.inverse,
      max_dimensions:
        dimension?.substring(0, 8) === "pre:date" ? 9999 : MAX_DIMENSIONS,
      rows,
    }).replace(/\\/g, "\\\\")}""", strict=False)

var_id_map = data['var_id_map']
var_names = data['var_names']
ignore_nulls = data['ignore_nulls']
inverse = data['inverse']
weights = data['weights']
max_dimensions = data['max_dimensions']
baseline_index = data['baseline_index']

rows = pd.DataFrame(data['rows'])

unknown_var_ids = detect_unknown_variations(
  rows=rows,
  var_id_map=var_id_map
)

${
  dimension === "pre:datedaily" ? `rows = diff_for_daily_time_series(rows)` : ``
}

df = get_metric_df(
  rows=rows,
  var_id_map=var_id_map,
  var_names=var_names,
)

reduced = reduce_dimensionality(
  df=df, 
  max=max_dimensions,
)

engine_config=${
      statsEngine === "frequentist" && sequentialTestingEnabled
        ? `{'sequential': True, 'sequential_tuning_parameter': ${sequentialTestingTuningParameterNumber}}`
        : "{}"
    }
engine_config['difference_type'] = ${differenceTypeString}
engine_config['phase_length_days'] = ${phaseLengthDays}
${
  statsEngine === "frequentist" && pValueThresholdNumber
    ? `engine_config['alpha'] = ${pValueThresholdNumber}`
    : ""
}

result = analyze_metric_df(
  df=reduced,
  weights=weights,
  inverse=inverse,
  engine=${
    statsEngine === "frequentist"
      ? "StatsEngine.FREQUENTIST"
      : "StatsEngine.BAYESIAN"
  },
  engine_config=engine_config,
)

print(json.dumps({
  'unknownVariations': list(unknown_var_ids),
  'dimensions': format_results(result, baseline_index)
}, allow_nan=False))`,
    {}
  );

  let parsed: ExperimentMetricAnalysis;
  try {
    parsed = JSON.parse(result?.[0]);

    // Add multiple exposures
    parsed.multipleExposures =
      rows.filter((r) => r.variation === "__multiple__")?.[0]?.users || 0;
  } catch (e) {
    logger.error(e, "Failed to run stats model: " + result);
    throw e;
  }

  return parsed;
}

export async function analyzeExperimentResults({
  queryData,
  analysisSettings,
  snapshotSettings,
  variationNames,
  metricMap,
}: {
  queryData: QueryMap;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  snapshotSettings: ExperimentSnapshotSettings;
  variationNames: string[];
  metricMap: Map<string, ExperimentMetricInterface>;
}): Promise<ExperimentReportResults> {
  const metricRows: {
    metric: string;
    rows: ExperimentMetricQueryResponseRows;
  }[] = [];

  let unknownVariations: string[] = [];
  let multipleExposures = 0;

  // Everything done in a single query (Mixpanel, Google Analytics)
  // Need to convert to the same format as SQL rows
  if (queryData.has("results")) {
    const results = queryData.get("results");
    if (!results) throw new Error("Empty experiment results");
    const data = results.result as ExperimentResults;

    unknownVariations = data.unknownVariations;
    const byMetric: { [key: string]: ExperimentMetricQueryResponseRows } = {};
    data.dimensions.forEach((row) => {
      row.variations.forEach((v) => {
        Object.keys(v.metrics).forEach((metric) => {
          const stats = v.metrics[metric];
          byMetric[metric] = byMetric[metric] || [];
          byMetric[metric].push({
            dimension: row.dimension,
            variation:
              snapshotSettings.variations[v.variation]?.id || v.variation + "",
            users: stats.count,
            count: stats.count,
            statistic_type: "mean", // no ratio in mixpanel or GA
            main_metric_type: stats.metric_type,
            main_sum: stats.main_sum,
            main_sum_squares: stats.main_sum_squares,
          });
        });
      });
    });

    Object.keys(byMetric).forEach((metric) => {
      metricRows.push({
        metric,
        rows: byMetric[metric],
      });
    });
  }
  // One query for each metric, can just use the rows directly from the query
  else {
    queryData.forEach((query, key) => {
      const metric = metricMap.get(key);
      if (!metric) return;

      metricRows.push({
        metric: key,
        rows: query.result as ExperimentMetricQueryResponseRows,
      });
    });
  }

  const dimensionMap: Map<string, ExperimentReportResultDimension> = new Map();
  await promiseAllChunks(
    metricRows.map((data) => {
      const metric = metricMap.get(data.metric);
      return async () => {
        if (!metric) return;
        const result = await analyzeExperimentMetric({
          variations: snapshotSettings.variations.map((v, i) => ({
            ...v,
            name: variationNames[i] || v.id,
          })),
          metric: metric,
          rows: data.rows,
          dimension: analysisSettings.dimensions[0],
          baselineVariationIndex: analysisSettings.baselineVariationIndex ?? 0,
          differenceType: analysisSettings.differenceType,
          coverage: snapshotSettings.coverage || 1,
          phaseLengthHours: Math.max(
            hoursBetween(snapshotSettings.startDate, snapshotSettings.endDate),
            1
          ),
          statsEngine: analysisSettings.statsEngine,
          sequentialTestingEnabled: analysisSettings.sequentialTesting ?? false,
          sequentialTestingTuningParameter:
            analysisSettings.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
          pValueThreshold:
            analysisSettings.pValueThreshold ?? DEFAULT_P_VALUE_THRESHOLD,
        });
        unknownVariations = unknownVariations.concat(result.unknownVariations);
        multipleExposures = Math.max(
          multipleExposures,
          result.multipleExposures
        );

        result.dimensions.forEach((row) => {
          const dim = dimensionMap.get(row.dimension) || {
            name: row.dimension,
            srm: 1,
            variations: [],
          };

          row.variations.forEach((v, i) => {
            const data = dim.variations[i] || {
              users: v.users,
              metrics: {},
            };
            data.users = Math.max(data.users, v.users);
            data.metrics[metric.id] = {
              ...v,
              buckets: [],
            };
            dim.variations[i] = data;
          });

          dimensionMap.set(row.dimension, dim);
        });
      };
    }),
    3
  );

  const dimensions = Array.from(dimensionMap.values());
  if (!dimensions.length) {
    dimensions.push({
      name: "All",
      srm: 1,
      variations: [],
    });
  } else {
    dimensions.forEach((dimension) => {
      // Calculate SRM
      dimension.srm = checkSrm(
        dimension.variations.map((v) => v.users),
        snapshotSettings.variations.map((v) => v.weight)
      );
    });
  }

  return {
    multipleExposures,
    unknownVariations: Array.from(new Set(unknownVariations)),
    dimensions,
  };
}
