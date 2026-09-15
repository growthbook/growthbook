import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { MetricValueParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getAggregateMetricColumnLegacyMetrics } from "back-end/src/integrations/sql/columns/aggregate-metric-column-legacy-metrics";
import { getIdentitiesCTE } from "back-end/src/integrations/sql/ctes/identities-cte";
import { getMetricCTE } from "back-end/src/integrations/sql/ctes/metric-cte";
import { getMetricEnd } from "back-end/src/integrations/sql/dates/metric-end";
import { getMetricMinDelay } from "back-end/src/integrations/sql/dates/metric-min-delay";
import { getMetricStart } from "back-end/src/integrations/sql/dates/metric-start";
import { getSegmentCTE } from "back-end/src/integrations/sql/ctes/segment-cte";

export function getMetricValueQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: MetricValueParams,
): string {
  const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
    dialect,
    datasource.settings,
    {
      objects: [
        params.metric.userIdTypes || [],
        params.segment ? [params.segment.userIdType || "user_id"] : [],
      ],
      from: params.from,
      to: params.to,
    },
  );

  const metricStart = getMetricStart(
    params.from,
    getMetricMinDelay([params.metric]),
    0,
  );
  const metricEnd = getMetricEnd([params.metric], params.to);

  const aggregate = getAggregateMetricColumnLegacyMetrics(dialect, {
    metric: params.metric,
  });

  return format(
    `-- ${params.name} - ${params.metric.name} Metric
      WITH
        ${idJoinSQL}
        ${
          params.segment
            ? `segment as (${getSegmentCTE(
                dialect,
                params.segment,
                baseIdType,
                idJoinMap,
                params.factTableMap,
              )}),`
            : ""
        }
        __metric as (${getMetricCTE(dialect, {
          metric: params.metric,
          baseIdType,
          idJoinMap,
          startDate: metricStart,
          endDate: metricEnd,
          factTableMap: new Map(),
        })})
        , __userMetric as (
          -- Add in the aggregate metric value for each user
          SELECT
            ${aggregate} as value
          FROM
            __metric m
            ${
              params.segment
                ? `JOIN segment s ON (s.${baseIdType} = m.${baseIdType}) WHERE s.date <= m.timestamp`
                : ""
            }
          GROUP BY
            m.${baseIdType}
        )
        , __overall as (
          SELECT
            COUNT(*) as count,
            COALESCE(SUM(value), 0) as main_sum,
            COALESCE(SUM(POWER(value, 2)), 0) as main_sum_squares
          from
            __userMetric
        )
        ${
          params.includeByDate
            ? `
          , __userMetricDates as (
            -- Add in the aggregate metric value for each user
            SELECT
              ${dialect.dateTrunc("m.timestamp", "day")} as date,
              ${aggregate} as value
            FROM
              __metric m
              ${
                params.segment
                  ? `JOIN segment s ON (s.${baseIdType} = m.${baseIdType}) WHERE s.date <= m.timestamp`
                  : ""
              }
            GROUP BY
              ${dialect.dateTrunc("m.timestamp", "day")},
              m.${baseIdType}
          )
          , __byDateOverall as (
            SELECT
              date,
              COUNT(*) as count,
              COALESCE(SUM(value), 0) as main_sum,
              COALESCE(SUM(POWER(value, 2)), 0) as main_sum_squares
            FROM
              __userMetricDates d
            GROUP BY
              date
          )`
            : ""
        }
      ${
        params.includeByDate
          ? `
        , __union as (
          SELECT 
            null as date,
            o.*
          FROM
            __overall o
          UNION ALL
          SELECT
            d.*
          FROM
            __byDateOverall d
        )
        SELECT
          *
        FROM
          __union
        ORDER BY
          date ASC
      `
          : `
        SELECT
          o.*
        FROM
          __overall o
      `
      }
      
      `,
    dialect.formatDialect,
  );
}
