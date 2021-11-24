import { MetricInterface, MetricStats } from "../../types/metric";
import { PythonShell } from "python-shell";
import { promisify } from "util";
import { ExperimentMetricQueryResponse } from "../types/Integration";
import { ExperimentReportVariation } from "../../types/report";

export const MAX_DIMENSIONS = 20;

export interface StatsEngineDimensionResponse {
  dimension: string;
  srm: number;
  variations: {
    cr: number;
    value: number;
    users: number;
    stats: MetricStats;
    expected?: number;
    chanceToWin?: number;
    uplift?: {
      dist: string;
      mean?: number;
      stddev?: number;
    };
    ci?: [number, number];
    risk?: [number, number];
  }[];
}

export interface ExperimentMetricAnalysis {
  unknownVariations: string[];
  dimensions: StatsEngineDimensionResponse[];
}

export async function analyzeExperimentMetric(
  variations: ExperimentReportVariation[],
  metric: MetricInterface,
  rows: ExperimentMetricQueryResponse,
  maxDimensions: number
): Promise<ExperimentMetricAnalysis> {
  if (!rows || !rows.length) {
    return {
      unknownVariations: [],
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
  detect_unknown_variations,
  analyze_metric_df,
  get_metric_df,
  reduce_dimensionality,
  format_results
)
import pandas as pd
import json

data = json.loads("""${JSON.stringify({
      var_id_map: variationIdMap,
      var_names: variations.map((v) => v.name),
      weights: variations.map((v) => v.weight),
      type: metric.type,
      ignore_nulls: !!metric.ignoreNulls,
      inverse: !!metric.inverse,
      max_dimensions: maxDimensions,
      rows,
    }).replace(/\\/g, "\\\\")}""", strict=False)

var_id_map = data['var_id_map']
var_names = data['var_names']
ignore_nulls = data['ignore_nulls']
inverse = data['inverse']
type = data['type']
weights = data['weights']
max_dimensions = data['max_dimensions']

rows = pd.DataFrame(data['rows'])

unknown_var_ids = detect_unknown_variations(
  rows=rows,
  var_id_map=var_id_map
)

df = get_metric_df(
  rows=rows,
  var_id_map=var_id_map,
  var_names=var_names,
  ignore_nulls=ignore_nulls,
  type=type,
)

reduced = reduce_dimensionality(
  df=df, 
  max=max_dimensions
)

result = analyze_metric_df(
  df=reduced,
  weights=weights,
  type=type,
  inverse=inverse,
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
  } catch (e) {
    console.error("Failed to run stats model", result);
    throw e;
  }

  return parsed;
}

/**
 * Calculates a combined standard deviation of two sets of data
 * From https://math.stackexchange.com/questions/2971315/how-do-i-combine-standard-deviations-of-two-groups
 */
function correctStddev(
  n: number,
  x: number,
  sx: number,
  m: number,
  y: number,
  sy: number
) {
  const vx = Math.pow(sx, 2);
  const vy = Math.pow(sy, 2);
  const t = n + m;

  if (t <= 1) return 0;

  return Math.sqrt(
    ((n - 1) * vx + (m - 1) * vy) / (t - 1) +
      (n * m * Math.pow(x - y, 2)) / (t * (t - 1))
  );
}

// Combines two means together with proper weighting
function correctMean(n: number, x: number, m: number, y: number) {
  if (n + m < 1) return 0;

  return (n * x + m * y) / (n + m);
}

/**
 * This takes a mean/stddev from only converted users and
 * adjusts them to include non-converted users
 */
export function addNonconvertingUsersToStats(stats: MetricStats) {
  const m = stats.users - stats.count;
  return {
    mean: correctMean(stats.count, stats.mean, m, 0),
    stddev: correctStddev(stats.count, stats.mean, stats.stddev, m, 0, 0),
  };
}
