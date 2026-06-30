import { getDelayWindowHours, getUserIdTypes } from "shared/experiments";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentUnitsQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

import { getConversionWindowClause } from "back-end/src/integrations/sql/clauses/conversion-window-clause";
import { getDimensionCTE } from "back-end/src/integrations/sql/ctes/dimension-cte";
import { getDimensionInStatement } from "back-end/src/integrations/sql/fact-metrics/dimension-in-statement";
import { getDimensionValuePerUnit } from "back-end/src/integrations/sql/fact-metrics/dimension-value-per-unit";
import { getExperimentEndDate } from "back-end/src/integrations/sql/dates/experiment-end-date";
import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";
import { getFirstVariationValuePerUnit } from "back-end/src/integrations/sql/columns/first-variation-value-per-unit";
import { getIdentitiesCTE } from "back-end/src/integrations/sql/ctes/identities-cte";
import { getMetricCTE } from "back-end/src/integrations/sql/ctes/metric-cte";
import { getMetricEnd } from "back-end/src/integrations/sql/dates/metric-end";
import { getMetricStart } from "back-end/src/integrations/sql/dates/metric-start";
import { processActivationMetric } from "back-end/src/integrations/sql/processing/process-activation-metric";
import { processDimensions } from "back-end/src/integrations/sql/processing/process-dimensions";
import { getSegmentCTE } from "back-end/src/integrations/sql/ctes/segment-cte";

export function getExperimentUnitsQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: ExperimentUnitsQueryParams,
): string {
  const {
    settings,
    segment,
    activationMetric: activationMetricDoc,
    factTableMap,
  } = params;

  const activationMetric = processActivationMetric(
    activationMetricDoc,
    settings,
  );

  const { experimentDimensions, unitDimensions } = processDimensions(
    dialect,
    params.dimensions,
    settings,
    activationMetric,
  );

  const exposureQuery = getExposureQuery(
    datasource,
    settings.exposureQueryId || "",
    undefined,
  );

  const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
    dialect,
    datasource.settings,
    {
      objects: [
        [exposureQuery.userIdType],
        activationMetric ? getUserIdTypes(activationMetric, factTableMap) : [],
        ...unitDimensions.map((d) => [d.dimension.userIdType || "user_id"]),
        segment ? [segment.userIdType || "user_id"] : [],
      ],
      from: settings.startDate,
      to: settings.endDate,
      forcedBaseIdType: exposureQuery.userIdType,
      experimentId: settings.experimentId,
    },
  );

  const startDate: Date = settings.startDate;
  const endDate: Date = getExperimentEndDate(settings, 0);

  const timestampColumn = "e.timestamp";
  const timestampDateTimeColumn = dialect.castUserDateCol(timestampColumn);
  const overrideConversionWindows =
    settings.attributionModel === "experimentDuration" ||
    settings.attributionModel === "lookbackOverride";

  return `
    ${params.includeIdJoins ? idJoinSQL : ""}
    __rawExperiment AS (
      ${compileSqlTemplate(
        exposureQuery.query,
        {
          startDate: settings.startDate,
          endDate: settings.endDate,
          experimentId: settings.experimentId,
          phase: settings.phase,
          customFields: settings.customFields,
        },
        dialect,
      )}
    ),
    __experimentExposures AS (
      -- Viewed Experiment
      SELECT
        e.${baseIdType} as ${baseIdType}
        , ${dialect.castToString("e.variation_id")} as variation
        , ${timestampDateTimeColumn} as timestamp
        ${experimentDimensions
          .map((d) => {
            if (d.specifiedSlices?.length) {
              return `, ${getDimensionInStatement(
                dialect,
                d.id,
                d.specifiedSlices,
              )} AS dim_${d.id}`;
            }
            return `, e.${d.id} AS dim_${d.id}`;
          })
          .join("\n")}
      FROM
          __rawExperiment e
      WHERE
          e.experiment_id = '${settings.experimentId}'
          AND ${timestampColumn} >= ${dialect.toTimestamp(startDate)}
          ${
            endDate
              ? `AND ${timestampColumn} <= ${dialect.toTimestamp(endDate)}`
              : ""
          }
          ${settings.queryFilter ? `AND (\n${settings.queryFilter}\n)` : ""}
    )
    ${
      activationMetric
        ? `, __activationMetric as (${getMetricCTE(dialect, {
            metric: activationMetric,
            baseIdType,
            idJoinMap,
            startDate: getMetricStart(
              settings.startDate,
              getDelayWindowHours(activationMetric.windowSettings),
              0,
            ),
            endDate: getMetricEnd(
              [activationMetric],
              settings.endDate,
              overrideConversionWindows,
            ),
            experimentId: settings.experimentId,
            phase: settings.phase,
            customFields: settings.customFields,
            factTableMap,
          })})
        `
        : ""
    }
    ${
      segment
        ? `, __segment as (${getSegmentCTE(
            dialect,
            segment,
            baseIdType,
            idJoinMap,
            factTableMap,
            {
              startDate: settings.startDate,
              endDate: settings.endDate,
              experimentId: settings.experimentId,
              phase: settings.phase,
              customFields: settings.customFields,
            },
          )})`
        : ""
    }
    ${unitDimensions
      .map(
        (d) =>
          `, __dim_unit_${d.dimension.id} as (${getDimensionCTE(
            d.dimension,
            baseIdType,
            idJoinMap,
          )})`,
      )
      .join("\n")}
    , __experimentUnits AS (
      -- One row per user
      SELECT
        e.${baseIdType} AS ${baseIdType}
        , ${
          !!settings.banditSettings?.useFirstExposure && settings.banditSettings
            ? getFirstVariationValuePerUnit(dialect)
            : dialect.ifElse(
                "count(distinct e.variation) > 1",
                "'__multiple__'",
                "max(e.variation)",
              )
        } AS variation
        , MIN(${timestampColumn}) AS first_exposure_timestamp
        ${unitDimensions
          .map(
            (d) => `
          , ${getDimensionValuePerUnit(dialect, d)} AS dim_unit_${d.dimension.id}`,
          )
          .join("\n")}
        ${experimentDimensions
          .map(
            (d) => `
          , ${getDimensionValuePerUnit(dialect, d)} AS dim_exp_${d.id}`,
          )
          .join("\n")}
        ${
          activationMetric
            ? `, MIN(${dialect.ifElse(
                getConversionWindowClause(
                  dialect,
                  "e.timestamp",
                  "a.timestamp",
                  activationMetric,
                  settings.endDate,
                  overrideConversionWindows,
                ),
                "a.timestamp",
                "NULL",
              )}) AS first_activation_timestamp
            `
            : ""
        }
      FROM
        __experimentExposures e
        ${
          segment
            ? `JOIN __segment s ON (s.${baseIdType} = e.${baseIdType})`
            : ""
        }
        ${unitDimensions
          .map(
            (d) => `
            LEFT JOIN __dim_unit_${d.dimension.id} __dim_unit_${d.dimension.id} ON (
              __dim_unit_${d.dimension.id}.${baseIdType} = e.${baseIdType}
            )
          `,
          )
          .join("\n")}
        ${
          activationMetric
            ? `LEFT JOIN __activationMetric a ON (a.${baseIdType} = e.${baseIdType})`
            : ""
        }
      ${segment ? `WHERE s.date <= e.timestamp` : ""}
      GROUP BY
        e.${baseIdType}
    )`;
}
