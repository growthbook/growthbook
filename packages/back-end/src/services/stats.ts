import { promisify } from "util";
import { PythonShell } from "python-shell";
import {
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { MetricInterface } from "../../types/metric";
import { ExperimentMetricAnalysis, StatsEngine } from "../../types/stats";
import {
  ExperimentMetricQueryResponse,
  ExperimentResults,
} from "../types/Integration";
import {
  ExperimentReportResultDimension,
  ExperimentReportResults,
  ExperimentReportVariation,
} from "../../types/report";
import { promiseAllChunks } from "../util/promise";
import { checkSrm } from "../util/stats";
import { logger } from "../util/logger";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "../../types/experiment-snapshot";
import { QueryMap } from "../queryRunners/QueryRunner";

export const MAX_DIMENSIONS = 20;

export async function analyzeExperimentMetric(
  variations: ExperimentReportVariation[],
  metric: MetricInterface,
  rows: ExperimentMetricQueryResponse,
  dimension: string | null = null,
  statsEngine: StatsEngine = DEFAULT_STATS_ENGINE,
  sequentialTestingEnabled: boolean = false,
  sequentialTestingTuningParameter: number = DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER
): Promise<ExperimentMetricAnalysis> {
  if (!rows || !rows.length) {
    return {
      unknownVariations: [],
      multipleExposures: 0,
      dimensions: [],
    };
  }

  const variationIdMap: { [key: string]: number } = {};
  variations.map((v, i) => {
    variationIdMap[v.id] = i;
  });

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
from gbstats.shared.constants import StatsEngine
import pandas as pd
import json

data = json.loads("""${JSON.stringify({
      var_id_map: variationIdMap,
      var_names: variations.map((v) => v.name),
      weights: variations.map((v) => v.weight),
      ignore_nulls: !!metric.ignoreNulls,
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
  max=max_dimensions
)

result = analyze_metric_df(
  df=reduced,
  weights=weights,
  inverse=inverse,
  engine=${
    statsEngine === "frequentist"
      ? "StatsEngine.FREQUENTIST"
      : "StatsEngine.BAYESIAN"
  },
  engine_config=${
    statsEngine === "frequentist" && sequentialTestingEnabled
      ? `{'sequential': True, 'sequential_tuning_parameter': ${sequentialTestingTuningParameter}}`
      : "{}"
  }
)

print(json.dumps({
  'unknownVariations': list(unknown_var_ids),
  'dimensions': format_results(result)
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
  variationNames?: string[];
  metricMap: Map<string, MetricInterface>;
}): Promise<ExperimentReportResults> {
  const metricRows: {
    metric: string;
    rows: ExperimentMetricQueryResponse;
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
    const byMetric: { [key: string]: ExperimentMetricQueryResponse } = {};
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
        rows: query.result as ExperimentMetricQueryResponse,
      });
    });
  }

  const dimensionMap: Map<string, ExperimentReportResultDimension> = new Map();
  await promiseAllChunks(
    metricRows.map((data) => {
      const metric = metricMap.get(data.metric);
      return async () => {
        if (!metric) return;
        const result = await analyzeExperimentMetric(
          snapshotSettings.variations.map((v, i) => ({
            ...v,
            name: variationNames?.[i] || v.id,
          })),
          metric,
          data.rows,
          analysisSettings.dimensions[0],
          analysisSettings.statsEngine,
          analysisSettings.sequentialTesting,
          analysisSettings.sequentialTestingTuningParameter
        );
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
