import { parseIntWithDefault } from "shared/util";
import type { ExperimentFactMetricsQueryResponseRows } from "shared/types/integrations";

import {
  ALL_NON_QUANTILE_METRIC_FLOAT_COLS,
  MAX_METRICS_PER_QUERY,
} from "back-end/src/services/experimentQueries/constants";

import { getQuantileBoundsFromQueryResponse } from "back-end/src/integrations/sql/columns/quantile-bounds-from-query-response";

export function processExperimentFactMetricsQueryRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: Record<string, any>[],
): ExperimentFactMetricsQueryResponseRows {
  return rows.map((row) => {
    let metricData: {
      [key: string]: number | string;
    } = {};
    for (let i = 0; i < MAX_METRICS_PER_QUERY; i++) {
      const prefix = `m${i}_`;
      if (!row[prefix + "id"]) break;

      metricData[prefix + "id"] = row[prefix + "id"];
      ALL_NON_QUANTILE_METRIC_FLOAT_COLS.forEach((col) => {
        if (row[prefix + col] !== undefined) {
          metricData[prefix + col] = parseFloat(row[prefix + col]) || 0;
        }
      });

      metricData = {
        ...metricData,
        ...getQuantileBoundsFromQueryResponse(row, prefix),
      };
    }

    const dimensionData: Record<string, string> = {};
    Object.entries(row)
      .filter(([key, _]) => key.startsWith("dim_") || key === "dimension")
      .forEach(([key, value]) => {
        dimensionData[key] = value;
      });

    return {
      variation: row.variation ?? "",
      ...dimensionData,
      users: parseIntWithDefault(row.users, 0),
      count: parseIntWithDefault(row.users, 0),
      ...metricData,
    };
  });
}
