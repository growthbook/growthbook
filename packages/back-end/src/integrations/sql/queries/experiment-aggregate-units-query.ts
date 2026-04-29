import { BANDIT_SRM_DIMENSION_NAME } from "shared/constants";
import { getUserIdTypes } from "shared/experiments";
import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentAggregateUnitsQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { MAX_ROWS_UNIT_AGGREGATE_QUERY } from "back-end/src/services/experimentQueries/constants";

import { getBanditCaseWhen } from "back-end/src/integrations/sql/clauses/bandit-case-when";
import { getBanditVariationPeriodWeights } from "back-end/src/integrations/sql/clauses/bandit-variation-period-weights";
import { getDimensionInStatement } from "back-end/src/integrations/sql/fact-metrics/dimension-in-statement";
import { getExperimentUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-units-query";
import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";
import { getIdentitiesCTE } from "back-end/src/integrations/sql/ctes/identities-cte";
import { getUnitCountCTE } from "back-end/src/integrations/sql/ctes/unit-count-cte";

export function getExperimentAggregateUnitsQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: ExperimentAggregateUnitsQueryParams,
): string {
  const { activationMetric, segment, settings, factTableMap, useUnitsTable } =
    params;

  const experimentDimensions = params.dimensions;

  const exposureQuery = getExposureQuery(
    datasource,
    settings.exposureQueryId || "",
  );

  const banditDates = settings.banditSettings?.historicalWeights.map(
    (w) => w.date,
  );
  const variationPeriodWeights = settings.banditSettings
    ? getBanditVariationPeriodWeights(
        settings.banditSettings,
        settings.variations,
      )
    : undefined;

  const computeBanditSrm = !!banditDates && !!variationPeriodWeights;

  const { baseIdType, idJoinSQL } = getIdentitiesCTE(
    dialect,
    datasource.settings,
    {
      objects: [
        [exposureQuery.userIdType],
        !useUnitsTable && activationMetric
          ? getUserIdTypes(activationMetric, factTableMap)
          : [],
        !useUnitsTable && segment ? [segment.userIdType || "user_id"] : [],
      ],
      from: settings.startDate,
      to: settings.endDate,
      forcedBaseIdType: exposureQuery.userIdType,
      experimentId: settings.experimentId,
    },
  );

  return format(
    `-- Traffic Query for Health Tab
    WITH
      ${idJoinSQL}
      ${
        !useUnitsTable
          ? `${getExperimentUnitsQuery(dialect, datasource, {
              ...params,
              includeIdJoins: false,
            })},`
          : ""
      }
      __distinctUnits AS (
        SELECT
          ${baseIdType}
          , variation
          , ${dialect.formatDate(
            dialect.dateTrunc("first_exposure_timestamp", "day"),
          )} AS dim_exposure_date
          ${banditDates ? `${getBanditCaseWhen(dialect, banditDates)}` : ""}
          ${experimentDimensions
            .map(
              (d) =>
                `, ${getDimensionInStatement(
                  dialect,
                  `dim_exp_${d.id}`,
                  d.specifiedSlices,
                )} AS dim_exp_${d.id}`,
            )
            .join("\n")}
          ${
            activationMetric
              ? `, ${dialect.ifElse(
                  `first_activation_timestamp IS NULL`,
                  "'Not Activated'",
                  "'Activated'",
                )} AS dim_activated`
              : ""
          }
        FROM ${
          useUnitsTable ? `${params.unitsTableFullName}` : "__experimentUnits"
        }
      )
      , __unitsByDimension AS (
        -- One row per variation per dimension slice
        ${[
          "dim_exposure_date",
          ...experimentDimensions.map((d) => `dim_exp_${d.id}`),
          ...(activationMetric ? ["dim_activated"] : []),
        ]
          .map((d) =>
            getUnitCountCTE(
              dialect,
              d,
              activationMetric && d !== "dim_activated"
                ? "WHERE dim_activated = 'Activated'"
                : "",
              computeBanditSrm,
            ),
          )
          .join("\nUNION ALL\n")}
      )
      ${
        computeBanditSrm
          ? `
        , variationBanditPeriodWeights AS (
          ${variationPeriodWeights
            .map(
              (w) => `
            SELECT
              ${dialect.castToString(`'${w.variationId}'`)} AS variation
              , ${dialect.toTimestamp(w.date)} AS bandit_period
              , ${w.weight} AS weight
          `,
            )
            .join("\nUNION ALL\n")}
        )
        , __unitsByVariationBanditPeriod AS (
          SELECT
            v.variation AS variation
            , v.bandit_period AS bandit_period
            , v.weight AS weight
            , COALESCE(COUNT(d.bandit_period), 0) AS units
          FROM variationBanditPeriodWeights v
          LEFT JOIN __distinctUnits d
            ON (d.variation = v.variation AND d.bandit_period = v.bandit_period)
          GROUP BY
            v.variation
            , v.bandit_period
            , v.weight
        )
        , __totalUnitsByBanditPeriod AS (
          SELECT
            bandit_period
            , SUM(units) AS total_units
          FROM __unitsByVariationBanditPeriod
          GROUP BY
            bandit_period
        )
        , __expectedUnitsByVariationBanditPeriod AS (
          SELECT
            u.variation AS variation
            , MAX(${dialect.castToString("''")}) AS constant
            , SUM(u.units) AS units
            , SUM(t.total_units * u.weight) AS expected_units
          FROM __unitsByVariationBanditPeriod u
          LEFT JOIN __totalUnitsByBanditPeriod t
            ON (t.bandit_period = u.bandit_period)
          WHERE
            COALESCE(t.total_units, 0) > 0
          GROUP BY
            u.variation
        )
        , __banditSrm AS (
          SELECT
            MAX(${dialect.castToString("''")}) AS variation
            , MAX(${dialect.castToString("''")}) AS dimension_value
            , MAX(${dialect.castToString(
              `'${BANDIT_SRM_DIMENSION_NAME}'`,
            )}) AS dimension_name
            , SUM(POW(expected_units - units, 2) / expected_units) AS units
          FROM __expectedUnitsByVariationBanditPeriod
          GROUP BY
            constant
        ),
        __unitsByDimensionWithBanditSrm AS (
          SELECT
            *
          FROM __unitsByDimension
          UNION ALL
          SELECT
            *
          FROM __banditSrm
        )
      `
          : ""
      }

      ${dialect.selectStarLimit(
        computeBanditSrm
          ? "__unitsByDimensionWithBanditSrm"
          : "__unitsByDimension",
        MAX_ROWS_UNIT_AGGREGATE_QUERY,
      )}
    `,
    dialect.formatDialect,
  );
}
