import { promisify } from "util";
import { PythonShell } from "python-shell";
import { MetricInterface } from "../../types/metric";
import { ExperimentMetricAnalysis } from "../../types/stats";
import {
  ExperimentMetricQueryResponse,
  ExperimentResults,
} from "../types/Integration";
import {
  ExperimentReportResultDimension,
  ExperimentReportResults,
  ExperimentReportVariation,
} from "../../types/report";
import { getMetricsByOrganization } from "../models/MetricModel";
import { promiseAllChunks } from "../util/promise";
import { checkSrm } from "../util/stats";
import { logger } from "../util/logger";
import { OrganizationSettings } from "../../types/organization";
import { QueryMap } from "./queries";

export const MAX_DIMENSIONS = 20;

export async function analyzeExperimentMetric(
  variations: ExperimentReportVariation[],
  metric: MetricInterface,
  rows: ExperimentMetricQueryResponse,
  maxDimensions: number,
  statsEngine: OrganizationSettings["statsEngine"] = "bayesian"
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
  needs_correction=False
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
  engine=${
    statsEngine === "frequentist"
      ? "StatsEngine.FREQUENTIST"
      : "StatsEngine.BAYESIAN"
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

export async function analyzeExperimentResults(
  organization: string,
  variations: ExperimentReportVariation[],
  dimension: string | undefined,
  queryData: QueryMap,
  statsEngine: OrganizationSettings["statsEngine"] = "bayesian"
): Promise<ExperimentReportResults> {
  const metrics = await getMetricsByOrganization(organization);
  const metricMap = new Map<string, MetricInterface>();
  metrics.forEach((m) => {
    metricMap.set(m.id, m);
  });

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
            ...stats,
            dimension: row.dimension,
            variation: variations[v.variation].id,
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
          variations,
          metric,
          data.rows,
          dimension === "pre:date" ? 100 : MAX_DIMENSIONS,
          statsEngine
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
        variations.map((v) => v.weight)
      );
    });
  }

  return {
    multipleExposures,
    unknownVariations: Array.from(new Set(unknownVariations)),
    dimensions,
  };
}
