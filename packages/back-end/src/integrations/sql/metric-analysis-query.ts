import { DEFAULT_METRIC_HISTOGRAM_BINS } from "shared/constants";
import { getUserIdTypes, isRatioMetric } from "shared/experiments";
import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { MetricAnalysisParams } from "shared/types/integrations";
import type { SqlHelpers } from "shared/types/sql";

import { capCoalesceValue } from "./cap-coalesce-value";
import { getFactMetricCTE } from "./fact-metric-cte";
import { getIdentitiesCTE } from "./identities-cte";
import { getMetricAnalysisPopulationCTEs } from "./metric-analysis-population-ctes";
import { getMetricAnalysisStatisticClauses } from "./metric-analysis-statistic-clauses";
import { getMetricData } from "./metric-data";

export function getMetricAnalysisQuery(
  helpers: SqlHelpers,
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
    helpers,
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
    helpers,
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

  const finalValueColumn = capCoalesceValue(helpers, {
    valueCol: "value",
    metric,
    capTablePrefix: "cap",
    capValueCol: "value_capped",
    columnRef: metric.numerator,
  });
  const finalDenominatorColumn = capCoalesceValue(helpers, {
    valueCol: "denominator",
    metric,
    capTablePrefix: "cap",
    capValueCol: "denominator_capped",
    columnRef: metric.denominator,
  });

  const populationSQL = getMetricAnalysisPopulationCTEs(helpers, {
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
      __factTable AS (${getFactMetricCTE(helpers, {
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
            , ${helpers.dateTrunc("f.timestamp", "day")} AS date
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
            ${helpers.dateTrunc("f.timestamp", "day")}
            , ${populationSQL ? "p" : "f"}.${baseIdType}
        )
        , __userMetricOverall AS (
          SELECT
            ${baseIdType}
            , ${metricData.aggregatedValueTransformation({
              column: metricData.numeratorAggFns.reAggregationFunction(
                "value_for_reaggregation",
              ),
              initialTimestampColumn: helpers.toTimestamp(settings.startDate),
              analysisEndDate: settings.endDate,
            })} AS value
            ${
              metricData.ratioMetric
                ? `, ${metricData.aggregatedValueTransformation({
                    column: metricData.denominatorAggFns.reAggregationFunction(
                      "denominator_for_reaggregation",
                    ),
                    initialTimestampColumn: helpers.toTimestamp(
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
            ${helpers.percentileCapSelectClause(
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
            , MAX(${helpers.castToString("'date'")}) AS data_type
            , ${helpers.castToString(
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
            , ${helpers.castToFloat("NULL")} AS bin_width
            ${[...Array(DEFAULT_METRIC_HISTOGRAM_BINS).keys()]
              .map((i) => `, ${helpers.castToFloat("NULL")} AS units_bin_${i}`)
              .join("\n")}`
                : ""
            }
          FROM __userMetricDaily
          ${metricData.isPercentileCapped ? "CROSS JOIN __capValue cap" : ""}
          GROUP BY date
        )
        , __statisticsOverall AS (
          SELECT
            ${helpers.castToDate("NULL")} AS date
            , MAX(${helpers.castToString("'overall'")}) AS data_type
            , ${helpers.castToString(
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
            SUM(${helpers.ifElse(
              "m.value < (s.value_min + s.bin_width)",
              "1",
              "0",
            )}) as units_bin_0
            ${[...Array(DEFAULT_METRIC_HISTOGRAM_BINS - 2).keys()]
              .map(
                (i) =>
                  `, SUM(${helpers.ifElse(
                    `m.value >= (s.value_min + s.bin_width*${
                      i + 1
                    }.0) AND m.value < (s.value_min + s.bin_width*${i + 2}.0)`,
                    "1",
                    "0",
                  )}) as units_bin_${i + 1}`,
              )
              .join("\n")}
            , SUM(${helpers.ifElse(
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
    helpers.formatDialect,
  );
}
