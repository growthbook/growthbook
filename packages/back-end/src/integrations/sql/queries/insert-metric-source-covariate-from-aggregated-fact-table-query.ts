import cloneDeep from "lodash/cloneDeep";
import { format } from "shared/sql";
import { isRatioMetric } from "shared/experiments";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentMetricInterface } from "shared/experiments";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type { FactMetricInterface } from "shared/types/fact-table";
import type {
  CovariateWindowType,
  InsertMetricSourceCovariateFromAggregatedFactTableQueryParams,
} from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";
import { parseExperimentFactMetricsParams } from "back-end/src/integrations/sql/fact-metrics/parse-experiment-fact-metrics-params";
import { getMetricSourceCovariateTableColumns } from "back-end/src/integrations/sql/fact-metrics/metric-source-covariate-table-schema";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { capCoalesceValue } from "back-end/src/integrations/sql/primitives/cap-coalesce-value";
import { toTimestampWithMs } from "back-end/src/integrations/sql/primitives/to-timestamp-with-ms";
import { snapToUtcDayStart } from "back-end/src/integrations/sql/dates/covariate-day-bounds";

// Pre-aggregated covariate insert: re-aggregates a fact table's daily partials
// over each metric's covariate window instead of scanning raw events. Only used
// when resolveCovariateInsertPath validates the whole group against the
// registry, so the aggregated table is keyed on the exposure id type and every
// metric's daily partials can be re-aggregated.
export function getInsertMetricSourceCovariateFromAggregatedFactTableQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: InsertMetricSourceCovariateFromAggregatedFactTableQueryParams,
): string {
  const exposureQuery = getExposureQuery(
    datasource,
    params.settings.exposureQueryId || "",
    undefined,
  );
  // The aggregated table is keyed on the exposure id type (guaranteed by the
  // resolver), so no identity join is needed: the table's key column is also the
  // covariate cache's id column.
  const baseIdType = exposureQuery.userIdType;

  // Disable capping for covariate value creation; capping is applied in the
  // statistics query.
  const sortedMetrics = cloneDeep(params.metrics)
    .map((m) => ({
      ...m,
      cappingSettings: { type: "" as const, value: 0 },
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const paramsMetricsSorted: {
    metrics: FactMetricInterface[];
    activationMetric: ExperimentMetricInterface | null;
    settings: ExperimentSnapshotSettings;
    factTableMap: typeof params.factTableMap;
    covariateWindowType: CovariateWindowType;
    covariateTableAlias: string;
    forcedUserIdType?: string;
    lastMaxTimestamp: Date | null;
  } = {
    ...params,
    metrics: sortedMetrics,
    covariateWindowType: "phaseStart",
    covariateTableAlias: "c",
    lastMaxTimestamp: null,
  };

  const { sources, metricData } = parseExperimentFactMetricsParams(dialect, {
    ...paramsMetricsSorted,
    targetFactTableId: params.factTableId,
  });

  const source = sources.find((s) => s.factTable.id === params.factTableId);
  if (!source) {
    throw new Error(
      `getInsertMetricSourceCovariateFromAggregatedFactTableQuery: no metric data found for fact table "${params.factTableId}".`,
    );
  }

  const columnNames = getMetricSourceCovariateTableColumns(
    dialect,
    baseIdType,
    params.factTableId,
    sortedMetrics,
  );

  // Source-level scan window (day-snapped). Each metric's exact window is
  // applied per column below; this only bounds which daily partials are read.
  const scanStartDay = snapToUtcDayStart(source.minCovariateStartDate);
  const scanEndDay = snapToUtcDayStart(source.maxCovariateEndDate);

  return format(
    `
    INSERT INTO ${params.metricSourceCovariateTableFullName}
    (${columnNames.join(", \n")})
    SELECT * FROM (
      WITH
        __newCovariateValues AS (
          SELECT
            p.${baseIdType} AS ${baseIdType}
            ${metricData
              .map((m) => {
                const raSettings = m.raMetricPhaseStartSettings;
                // Day-snapped covariate window for this metric. Compared against
                // the aggregated table's `event_date`, mirroring the legacy
                // daily-aligned fallback.
                const startDay = snapToUtcDayStart(
                  raSettings.covariateStartDate,
                );
                const endDay = snapToUtcDayStart(raSettings.covariateEndDate);
                const windowFilter = `p.event_date >= ${toTimestampWithMs(startDay)} 
                  AND p.event_date < ${toTimestampWithMs(endDay)}`;
                const enc = encodeMetricIdForColumnName(m.id);
                // Role-aware FT comparison decides which side this FT's cache
                // holds (same gating as the materialized columns).
                const numeratorOnThisFt =
                  m.metric.numerator?.factTableId === params.factTableId;
                const denominatorOnThisFt =
                  isRatioMetric(m.metric) &&
                  m.metric.denominator?.factTableId === params.factTableId;
                const reAggNumerator = getAggregationMetadata(dialect, {
                  metric: m.metric,
                  useDenominator: false,
                }).reAggregationFunction;
                const reAggDenominator = getAggregationMetadata(dialect, {
                  metric: m.metric,
                  useDenominator: true,
                }).reAggregationFunction;
                return `
                ${
                  numeratorOnThisFt
                    ? `, ${reAggNumerator(
                        dialect.ifElse(windowFilter, `p.${enc}_value`, "NULL"),
                      )} AS ${m.alias}_covariate_value`
                    : ""
                }
                ${
                  denominatorOnThisFt
                    ? `, ${reAggDenominator(
                        dialect.ifElse(
                          windowFilter,
                          `p.${enc}_denominator_value`,
                          "NULL",
                        ),
                      )} AS ${m.alias}_covariate_denominator`
                    : ""
                }
              `;
              })
              .join("\n")}
          FROM ${params.aggregatedTableFullName} p
          INNER JOIN (
            SELECT ${baseIdType}
            FROM ${params.unitsSourceTableFullName}
            ${
              params.lastCovariateSuccessfulMaxTimestamp
                ? `WHERE max_timestamp > ${toTimestampWithMs(params.lastCovariateSuccessfulMaxTimestamp)}`
                : ""
            }
          ) d
            ON (d.${baseIdType} = p.${baseIdType})
          WHERE p.event_date >= ${toTimestampWithMs(scanStartDay)}
            AND p.event_date < ${toTimestampWithMs(scanEndDay)}
          GROUP BY
            p.${baseIdType}
        )
      SELECT
        ${baseIdType}
        ${metricData
          .map((m) => {
            const includeNumerator =
              m.metric.numerator?.factTableId === params.factTableId;
            const includeDenominator =
              m.ratioMetric &&
              m.metric.denominator?.factTableId === params.factTableId;
            // capCoalesceValue applies aggregate filters (capping is disabled
            // above) — same final projection as the legacy path.
            const numeratorCol = includeNumerator
              ? `, ${capCoalesceValue(dialect, {
                  valueCol: `c.${m.alias}_covariate_value`,
                  metric: m.metric,
                  columnRef: m.metric.numerator,
                })} AS ${encodeMetricIdForColumnName(m.id)}_value`
              : "";
            const denominatorCol = includeDenominator
              ? `, ${capCoalesceValue(dialect, {
                  valueCol: `c.${m.alias}_covariate_denominator`,
                  metric: m.metric,
                  columnRef: m.metric.denominator,
                })} AS ${encodeMetricIdForColumnName(m.id)}_denominator_value`
              : "";
            return `${numeratorCol}${denominatorCol}`;
          })
          .join("\n")}
      FROM __newCovariateValues c
      )
      `,
    dialect.formatDialect,
  );
}
