import { isContextualBanditAttrColumn } from "shared/experiments";
import { parseIntWithDefault } from "shared/util";
import type { ExperimentFactMetricsQueryResponseRows } from "shared/types/integrations";

import {
  ALL_NON_QUANTILE_METRIC_FLOAT_COLS,
  MAX_METRICS_PER_QUERY,
} from "back-end/src/services/experimentQueries/constants";

import { getQuantileBoundsFromQueryResponse } from "back-end/src/integrations/sql/columns/quantile-bounds-from-query-response";
import { parseFunnelStepSumColumn } from "back-end/src/integrations/sql/fact-metrics/funnel-columns";

const METRIC_COLUMN_RE = /^(m\d+)_(.+)$/;

export function processExperimentFactMetricsQueryRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: Record<string, any>[],
): ExperimentFactMetricsQueryResponseRows {
  return rows.map((row) => {
    // Index columns by metric once per row; probing every name per metric is quadratic on wide rows.
    const columnsByMetric: Record<string, Record<string, unknown>> = {};
    const funnelStepKeys: Record<string, string[]> = {};
    Object.keys(row).forEach((key) => {
      const match = key.match(METRIC_COLUMN_RE);
      if (match) (columnsByMetric[match[1]] ??= {})[match[2]] = row[key];
      // TODO(funnel): clean-up with alias helper to solidify
      // the column alias throughout the code
      const alias = parseFunnelStepSumColumn(key)?.alias;
      if (alias) (funnelStepKeys[alias] ??= []).push(key);
    });

    const metricData: {
      [key: string]: number | string;
    } = {};
    for (let i = 0; i < MAX_METRICS_PER_QUERY; i++) {
      const prefix = `m${i}_`;
      if (!row[prefix + "id"]) break;

      metricData[prefix + "id"] = row[prefix + "id"];
      const columns = columnsByMetric[`m${i}`] ?? {};
      ALL_NON_QUANTILE_METRIC_FLOAT_COLS.forEach((col) => {
        if (columns[col] !== undefined) {
          metricData[prefix + col] = parseFloat(String(columns[col])) || 0;
        }
      });

      // Funnel metrics emit one sum per step, so their columns aren't in a static list.
      funnelStepKeys[`m${i}`]?.forEach((key) => {
        metricData[key] = parseFloat(row[key]) || 0;
      });

      Object.assign(
        metricData,
        getQuantileBoundsFromQueryResponse(row, prefix),
      );
    }

    const dimensionData: Record<string, string> = {};
    Object.entries(row)
      .filter(([key, _]) => key.startsWith("dim_") || key === "dimension")
      .forEach(([key, value]) => {
        dimensionData[key] = value;
      });

    const attributeData: Record<string, string> = {};
    Object.entries(row)
      .filter(([key, _]) => isContextualBanditAttrColumn(key))
      .forEach(([key, value]) => {
        attributeData[key] = value;
      });

    return {
      variation: row.variation ?? "",
      ...dimensionData,
      ...attributeData,
      users: parseIntWithDefault(row.users, 0),
      count: parseIntWithDefault(row.users, 0),
      ...metricData,
    };
  });
}
