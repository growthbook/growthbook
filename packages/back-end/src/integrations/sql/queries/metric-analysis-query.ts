import { DEFAULT_METRIC_HISTOGRAM_BINS } from "shared/constants";
import { getUserIdTypes, isRatioMetric } from "shared/experiments";
import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { MetricAnalysisParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { capCoalesceValue } from "back-end/src/integrations/sql/primitives/cap-coalesce-value";
import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";
import { getIdentitiesCTE } from "back-end/src/integrations/sql/ctes/identities-cte";
import { getMetricAnalysisPopulationCTEs } from "back-end/src/integrations/sql/ctes/metric-analysis-population-ctes";
import { getMetricAnalysisStatisticClauses } from "back-end/src/integrations/sql/clauses/metric-analysis-statistic-clauses";
import { getMetricData } from "back-end/src/integrations/sql/fact-metrics/metric-data";

export function getMetricAnalysisQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  metric: FactMetricInterface,
  params: Omit<MetricAnalysisParams, "metric">,
): string {
  const { settings } = params;

  // Get any required identity join queries; only use same id type for now,
  // so not needed
  const idTypeObjects = [getUserIdTypes(metric, params.factTableMap)];

  // TODO check if query broken if segment has template variables
  // TODO return cap numbers
  const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
    dialect,
    datasource.settings,
    {
      objects: idTypeObjects,
      from: settings.startDate,
      to: settings.endDate ?? undefined,
      forcedBaseIdType: settings.userIdType,
    },
  );

  const factTable = params.factTableMap.get(
    metric.numerator?.factTableId || "",
  );
  if (!factTable) {
    throw new Error("Unknown fact table");
  }

  const metricData = getMetricData(
    dialect,
    { metric, index: 0 },
    {
      // Ignore conversion windows in aggregation functions
      attributionModel: "experimentDuration",
      regressionAdjustmentEnabled: false,
      startDate: settings.startDate,
      endDate: settings.endDate ?? undefined,
    },
    null,
    [{ factTable, index: 0 }],
    "m",
    "m0",
  );

  // TODO(sql): Support analyses for cross-table ratio metrics
  if (
    isRatioMetric(metric) &&
    metric.denominator &&
    metric.denominator.factTableId !== factTable.id
  ) {
    throw new Error(
      "Metric analyses for cross-table ratio metrics are not supported yet",
    );
  }

  if (metric.metricType === "dailyParticipation") {
    throw new Error(
      "Metric analyses for daily participation metrics are not supported yet",
    );
  }

  const createHistogram = metric.metricType === "mean";

  const finalValueColumn = capCoalesceValue(dialect, {
    valueCol: "value",
    metric,
    capTablePrefix: "cap",
    capValueCol: "value_capped",
    columnRef: metric.numerator,
  });
  const finalDenominatorColumn = capCoalesceValue(dialect, {
    valueCol: "denominator",
    metric,
    capTablePrefix: "cap",
    capValueCol: "denominator_capped",
    columnRef: metric.denominator,
  });

  const populationSQL = getMetricAnalysisPopulationCTEs(dialect, {
    datasource,
    settings,
    idJoinMap,
    factTableMap: params.factTableMap,
    segment: params.segment,
  });

  return format(
    `-- ${metric.name} Metric Analysis
      WITH
        ${idJoinSQL}
        ${populationSQL}
      __factTable AS (${getFactMetricCTE(dialect, {
        baseIdType,
        idJoinMap,
        metricsWithIndices: [{ metric: metric, index: 0 }],
        factTable,
        endDate: metricData.metricEnd,
        startDate: metricData.metricStart,
        addFiltersToWhere: settings.populationType == "metric",
      })})
        , __userMetricDaily AS (
          -- Get aggregated metric per user by day
          SELECT
          ${populationSQL ? "p" : "f"}.${baseIdType} AS ${baseIdType}
            , ${dialect.dateTrunc("f.timestamp", "day")} AS date
            , ${metricData.numeratorAggFns.fullAggregationFunction(`f.${metricData.alias}_value`)} AS value
            , ${metricData.numeratorAggFns.partialAggregationFunction(`f.${metricData.alias}_value`)} AS value_for_reaggregation
                  ${
                    metricData.ratioMetric
                      ? `, ${metricData.denominatorAggFns.fullAggregationFunction(`f.${metricData.alias}_denominator`)} AS denominator
                      , ${metricData.denominatorAggFns.partialAggregationFunction(`f.${metricData.alias}_denominator`)} AS denominator_for_reaggregation`
                      : ""
                  }
          
          ${
            populationSQL
              ? `
            FROM __population p 
            LEFT JOIN __factTable f ON (f.${baseIdType} = p.${baseIdType})`
              : `
            FROM __factTable f`
          } 
          GROUP BY
            ${dialect.dateTrunc("f.timestamp", "day")}
            , ${populationSQL ? "p" : "f"}.${baseIdType}
        )
        , __userMetricOverall AS (
          SELECT
            ${baseIdType}
            , ${metricData.aggregatedValueTransformation({
              column: metricData.numeratorAggFns.reAggregationFunction(
                "value_for_reaggregation",
              ),
              initialTimestampColumn: dialect.toTimestamp(settings.startDate),
              analysisEndDate: settings.endDate,
            })} AS value
            ${
              metricData.ratioMetric
                ? `, ${metricData.aggregatedValueTransformation({
                    column: metricData.denominatorAggFns.reAggregationFunction(
                      "denominator_for_reaggregation",
                    ),
                    initialTimestampColumn: dialect.toTimestamp(
                      settings.startDate,
                    ),
                    analysisEndDate: settings.endDate,
                  })} AS denominator`
                : ""
            }
          FROM
            __userMetricDaily
          GROUP BY
            ${baseIdType}
        )
        ${
          metricData.isPercentileCapped
            ? `
        , __capValue AS (
            ${dialect.percentileCapSelectClause(
              [
                {
                  valueCol: "value",
                  outputCol: "value_capped",
                  percentile: metricData.metric.cappingSettings.value ?? 1,
                  ignoreZeros:
                    metricData.metric.cappingSettings.ignoreZeros ?? false,
                  sourceIndex: metricData.numeratorSourceIndex,
                },
                ...(metricData.ratioMetric
                  ? [
                      {
                        valueCol: "denominator",
                        outputCol: "denominator_capped",
                        percentile:
                          metricData.metric.cappingSettings.value ?? 1,
                        ignoreZeros:
                          metricData.metric.cappingSettings.ignoreZeros ??
                          false,
                        sourceIndex: metricData.denominatorSourceIndex,
                      },
                    ]
                  : []),
              ],
              "__userMetricOverall",
            )}
        )
        `
            : ""
        }
        , __statisticsDaily AS (
          SELECT
            date
            , MAX(${dialect.castToString("'date'")}) AS data_type
            , ${dialect.castToString(
              `'${metric.cappingSettings.type ? "capped" : "uncapped"}'`,
            )} AS capped
            ${getMetricAnalysisStatisticClauses(
              finalValueColumn,
              finalDenominatorColumn,
              metricData.ratioMetric,
            )}
            ${
              createHistogram
                ? `
            , MIN(${finalValueColumn}) as value_min
            , MAX(${finalValueColumn}) as value_max
            , ${dialect.castToFloat("NULL")} AS bin_width
            ${[...Array(DEFAULT_METRIC_HISTOGRAM_BINS).keys()]
              .map((i) => `, ${dialect.castToFloat("NULL")} AS units_bin_${i}`)
              .join("\n")}`
                : ""
            }
          FROM __userMetricDaily
          ${metricData.isPercentileCapped ? "CROSS JOIN __capValue cap" : ""}
          GROUP BY date
        )
        , __statisticsOverall AS (
          SELECT
            ${dialect.castToDate("NULL")} AS date
            , MAX(${dialect.castToString("'overall'")}) AS data_type
            , ${dialect.castToString(
              `'${metric.cappingSettings.type ? "capped" : "uncapped"}'`,
            )} AS capped
            ${getMetricAnalysisStatisticClauses(
              finalValueColumn,
              finalDenominatorColumn,
              metricData.ratioMetric,
            )}
            ${
              createHistogram
                ? `
            , MIN(${finalValueColumn}) as value_min
            , MAX(${finalValueColumn}) as value_max
            , (MAX(${finalValueColumn}) - MIN(${finalValueColumn})) / ${DEFAULT_METRIC_HISTOGRAM_BINS}.0 as bin_width
            `
                : ""
            }
          FROM __userMetricOverall
        ${metricData.isPercentileCapped ? "CROSS JOIN __capValue cap" : ""}
        )
        ${
          createHistogram
            ? `
        , __histogram AS (
          SELECT
            SUM(${dialect.ifElse(
              "m.value < (s.value_min + s.bin_width)",
              "1",
              "0",
            )}) as units_bin_0
            ${[...Array(DEFAULT_METRIC_HISTOGRAM_BINS - 2).keys()]
              .map(
                (i) =>
                  `, SUM(${dialect.ifElse(
                    `m.value >= (s.value_min + s.bin_width*${
                      i + 1
                    }.0) AND m.value < (s.value_min + s.bin_width*${i + 2}.0)`,
                    "1",
                    "0",
                  )}) as units_bin_${i + 1}`,
              )
              .join("\n")}
            , SUM(${dialect.ifElse(
              `m.value >= (s.value_min + s.bin_width*${
                DEFAULT_METRIC_HISTOGRAM_BINS - 1
              }.0)`,
              "1",
              "0",
            )}) as units_bin_${DEFAULT_METRIC_HISTOGRAM_BINS - 1}
          FROM
            __userMetricOverall m
          CROSS JOIN
            __statisticsOverall s
        ) `
            : ""
        }
        SELECT
            *
        FROM __statisticsOverall
        ${createHistogram ? `CROSS JOIN __histogram` : ""}
        UNION ALL
        SELECT
            *
        FROM __statisticsDaily
      `,
    dialect.formatDialect,
  );
}
