import cloneDeep from "lodash/cloneDeep";
import { format } from "shared/sql";
import { isRatioMetric } from "shared/experiments";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentMetricInterface } from "shared/experiments";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type { FactMetricInterface } from "shared/types/fact-table";
import type {
  CovariateWindowType,
  InsertMetricSourceCovariateDataQueryParams,
} from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { snapToUtcDayStart } from "shared/dates";
import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";
import { getIdentitiesCTE } from "back-end/src/integrations/sql/ctes/identities-cte";
import { parseExperimentFactMetricsParams } from "back-end/src/integrations/sql/fact-metrics/parse-experiment-fact-metrics-params";
import { getMetricSourceCovariateTableColumns } from "back-end/src/integrations/sql/fact-metrics/metric-source-covariate-table-schema";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { capCoalesceValue } from "back-end/src/integrations/sql/primitives/cap-coalesce-value";
import { toTimestampWithMs } from "back-end/src/integrations/sql/primitives/to-timestamp-with-ms";

// Legacy covariate insert: scans raw fact-table events over the covariate
// window and aggregates them per unit. Used whenever the pre-aggregated table
// can't serve the group (see resolveCovariateInsertPath).
export function getInsertMetricSourceCovariateDataLegacyQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: InsertMetricSourceCovariateDataQueryParams,
): string {
  const exposureQuery = params.exposureQuery;

  // Capping is applied later in the statistics query.
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

  // Scope FT discovery to the target FT so cross-FT ratios sharing a hub
  // (e.g. `[A/B, A/C]`) don't trip the 2-FT cap in `getFactTablesForMetrics`.
  const { sources, metricData } = parseExperimentFactMetricsParams(dialect, {
    ...paramsMetricsSorted,
    targetFactTableId: params.factTableId,
  });

  const source = sources.find((s) => s.factTable.id === params.factTableId);
  if (!source) {
    throw new Error(
      `getInsertMetricSourceCovariateDataLegacyQuery: no metric data found for fact table "${params.factTableId}".`,
    );
  }

  const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
    dialect,
    datasource.settings,
    {
      objects: [
        [exposureQuery.userIdType],
        source.factTable?.userIdTypes || [],
      ],
      from: params.settings.startDate,
      to: params.settings.endDate,
      forcedBaseIdType: exposureQuery.userIdType,
      experimentId: params.settings.experimentId,
    },
  );

  const columnNames = getMetricSourceCovariateTableColumns(
    dialect,
    baseIdType,
    params.factTableId,
    sortedMetrics,
  );

  // Floor to UTC days when aligning, so this fallback computes the identical
  // covariate window as the pre-aggregated path (windowFilter is floored too).
  const scanStartDate = params.alignLegacyScanToDailyGrain
    ? snapToUtcDayStart(source.minCovariateStartDate)
    : source.minCovariateStartDate;
  const scanEndDate = params.alignLegacyScanToDailyGrain
    ? snapToUtcDayStart(source.maxCovariateEndDate)
    : source.maxCovariateEndDate;

  return format(
    `
    INSERT INTO ${params.metricSourceCovariateTableFullName}
    (${columnNames.join(", \n")})
    SELECT * FROM (
      WITH 
        ${idJoinSQL}
        __factTable AS (${getFactMetricCTE(dialect, {
          baseIdType,
          idJoinMap,
          factTable: source.factTable,
          startDate: scanStartDate,
          endDate: scanEndDate,
          experimentId: params.settings.experimentId,
          phase: params.settings.phase,
          customFields: params.settings.customFields,
          metricsWithIndices: metricData.map((m, i) => ({
            metric: m.metric,
            index: i,
          })),
          addFiltersToWhere: true,
          // Need to do < the end date to exclude the end date itself
          exclusiveEndDateFilter: true,
          castIdToString: true,
        })})
          , __newCovariateValues AS (
          SELECT
            m.${baseIdType} AS ${baseIdType}
            ${metricData
              .map((m) => {
                const raSettings = m.raMetricPhaseStartSettings;
                // Floor to whole UTC days when aligning to match the
                // pre-aggregated path; otherwise use exact timestamps.
                const windowStart = params.alignLegacyScanToDailyGrain
                  ? snapToUtcDayStart(raSettings.covariateStartDate)
                  : raSettings.covariateStartDate;
                const windowEnd = params.alignLegacyScanToDailyGrain
                  ? snapToUtcDayStart(raSettings.covariateEndDate)
                  : raSettings.covariateEndDate;
                const windowFilter = `m.timestamp >= ${toTimestampWithMs(windowStart)} 
                  AND m.timestamp < ${toTimestampWithMs(windowEnd)}`;
                // Use full aggregation function since we are
                // aggregating only once to the user level for CUPED data
                const aggfunction =
                  m.covariateNumeratorAggFns.fullAggregationFunction;
                const denomAggFunction =
                  m.covariateDenominatorAggFns.fullAggregationFunction;
                // FT-id comparison, not sourceIndex equality: with
                // targetFactTableId set, off-bucket sides fall back to index 0
                // and would spuriously match.
                const numeratorOnThisFt =
                  m.metric.numerator?.factTableId === params.factTableId;
                const denominatorOnThisFt =
                  isRatioMetric(m.metric) &&
                  m.metric.denominator?.factTableId === params.factTableId;
                return `
                ${
                  numeratorOnThisFt
                    ? `, ${aggfunction(
                        dialect.ifElse(
                          windowFilter,
                          `${m.alias}_value`,
                          "NULL",
                        ),
                      )} AS ${m.alias}_covariate_value`
                    : ""
                }
                ${
                  !!denomAggFunction && denominatorOnThisFt
                    ? `, ${denomAggFunction(
                        dialect.ifElse(
                          windowFilter,
                          `${m.alias}_denominator`,
                          "NULL",
                        ),
                      )} AS ${m.alias}_covariate_denominator`
                    : ""
                }
              `;
              })
              .join("\n")}
          FROM __factTable m
          INNER JOIN (
            SELECT ${baseIdType}
            FROM ${params.unitsSourceTableFullName}
            ${
              params.lastCovariateSuccessfulMaxTimestamp
                ? `WHERE max_timestamp > ${toTimestampWithMs(params.lastCovariateSuccessfulMaxTimestamp)}`
                : ""
            }
          ) d
            ON (d.${baseIdType} = m.${baseIdType})
          GROUP BY
            m.${baseIdType}
        )
      SELECT
        ${baseIdType}
        ${metricData
          .map((m) => {
            // Project only the side(s) this cache materializes.
            const includeNumerator =
              m.metric.numerator?.factTableId === params.factTableId;
            const includeDenominator =
              m.ratioMetric &&
              m.metric.denominator?.factTableId === params.factTableId;
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
