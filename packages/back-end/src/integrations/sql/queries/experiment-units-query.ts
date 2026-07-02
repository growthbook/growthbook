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
import { getFirstVariationValuePerUnit } from "back-end/src/integrations/sql/columns/first-variation-value-per-unit";
import { getIdentitiesCTE } from "back-end/src/integrations/sql/ctes/identities-cte";
import { getMetricCTE } from "back-end/src/integrations/sql/ctes/metric-cte";
import { getMetricEnd } from "back-end/src/integrations/sql/dates/metric-end";
import { getMetricStart } from "back-end/src/integrations/sql/dates/metric-start";
import { processActivationMetric } from "back-end/src/integrations/sql/processing/process-activation-metric";
import { processDimensions } from "back-end/src/integrations/sql/processing/process-dimensions";
import { getSegmentCTE } from "back-end/src/integrations/sql/ctes/segment-cte";
import {
  getContextualBanditExposureSelectCols,
  getContextualBanditUnitsBaseSelectCols,
  getContextualBanditUnitsCTEs,
  getContextualBanditUnitsSqlConfig,
} from "back-end/src/integrations/sql/ctes/contextual-bandit-experiment-units-cte";

type ExperimentUnitsQueryContextualBanditStrings = {
  contextualExposureSelectCols: string;
  contextualUnitsBaseSelectCols: string;
  unitsCteName: string;
  unitsBaseColumnRefs: string;
};

export function getExperimentUnitsQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: ExperimentUnitsQueryParams,
): string {
  const {
    unitsSettings,
    segment,
    activationMetric: activationMetricDoc,
    factTableMap,
  } = params;

  const activationMetric = processActivationMetric(
    activationMetricDoc,
    unitsSettings,
  );

  const { experimentDimensions, unitDimensions } = processDimensions(
    dialect,
    params.dimensions,
    unitsSettings,
    activationMetric,
  );

  const exposureQuery = unitsSettings.exposureQuery;

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
      from: unitsSettings.startDate,
      to: unitsSettings.endDate,
      forcedBaseIdType: exposureQuery.userIdType,
      experimentId: unitsSettings.experimentId,
    },
  );

  const startDate: Date = unitsSettings.startDate;
  const endDate: Date = getExperimentEndDate(unitsSettings, 0);

  const timestampColumn = "e.timestamp";
  const timestampDateTimeColumn = dialect.castUserDateCol(timestampColumn);
  const overrideConversionWindows =
    unitsSettings.attributionModel === "experimentDuration" ||
    unitsSettings.attributionModel === "lookbackOverride";

  const contextualBanditCfg = getContextualBanditUnitsSqlConfig(unitsSettings);

  const {
    contextualExposureSelectCols,
    contextualUnitsBaseSelectCols,
    unitsCteName,
    unitsBaseColumnRefs,
  }: ExperimentUnitsQueryContextualBanditStrings = contextualBanditCfg
    ? {
        contextualExposureSelectCols: getContextualBanditExposureSelectCols(
          contextualBanditCfg.aliases,
        ),
        contextualUnitsBaseSelectCols: getContextualBanditUnitsBaseSelectCols(
          dialect,
          contextualBanditCfg.aliases,
          timestampColumn,
        ),
        unitsCteName: "__experimentUnitsBase",
        unitsBaseColumnRefs: [
          `u.${baseIdType}`,
          "u.variation",
          "u.first_exposure_timestamp",
          ...unitDimensions.map((d) => `u.dim_unit_${d.dimension.id}`),
          ...experimentDimensions.map((d) => `u.dim_exp_${d.id}`),
          ...(activationMetric ? ["u.first_activation_timestamp"] : []),
        ].join("\n,"),
      }
    : {
        contextualExposureSelectCols: "",
        contextualUnitsBaseSelectCols: "",
        unitsCteName: "__experimentUnits",
        unitsBaseColumnRefs: "",
      };
  const contextualAfterUnitsCtes = contextualBanditCfg
    ? getContextualBanditUnitsCTEs(dialect, {
        aliases: contextualBanditCfg.aliases,
        maxRankedContexts: contextualBanditCfg.maxRankedContexts,
        unitsBaseCteName: unitsCteName,
        baseColumnRefs: unitsBaseColumnRefs,
      })
    : "";

  return `
    ${params.includeIdJoins ? idJoinSQL : ""}
    __rawExperiment AS (
      ${compileSqlTemplate(
        exposureQuery.query,
        {
          startDate: unitsSettings.startDate,
          endDate: unitsSettings.endDate,
          experimentId: unitsSettings.experimentId,
          phase: unitsSettings.phase,
          customFields: unitsSettings.customFields,
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
        ${contextualExposureSelectCols}
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
          e.experiment_id = '${unitsSettings.experimentId}'
          AND ${timestampColumn} >= ${dialect.toTimestamp(startDate)}
          ${
            endDate
              ? `AND ${timestampColumn} <= ${dialect.toTimestamp(endDate)}`
              : ""
          }
          ${
            unitsSettings.queryFilter
              ? `AND (\n${unitsSettings.queryFilter}\n)`
              : ""
          }
    )
    ${
      activationMetric
        ? `, __activationMetric as (${getMetricCTE(dialect, {
            metric: activationMetric,
            baseIdType,
            idJoinMap,
            startDate: getMetricStart(
              unitsSettings.startDate,
              getDelayWindowHours(activationMetric.windowSettings),
              0,
            ),
            endDate: getMetricEnd(
              [activationMetric],
              unitsSettings.endDate,
              overrideConversionWindows,
            ),
            experimentId: unitsSettings.experimentId,
            phase: unitsSettings.phase,
            customFields: unitsSettings.customFields,
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
              startDate: unitsSettings.startDate,
              endDate: unitsSettings.endDate,
              experimentId: unitsSettings.experimentId,
              phase: unitsSettings.phase,
              customFields: unitsSettings.customFields,
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
    , ${unitsCteName} AS (
      -- One row per user
      SELECT
        e.${baseIdType} AS ${baseIdType}
        , ${
          !!unitsSettings.banditSettings?.useFirstExposure &&
          unitsSettings.banditSettings
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
                  unitsSettings.endDate,
                  overrideConversionWindows,
                ),
                "a.timestamp",
                "NULL",
              )}) AS first_activation_timestamp
            `
            : ""
        }
        ${contextualUnitsBaseSelectCols}
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
    )${contextualAfterUnitsCtes}`;
}
