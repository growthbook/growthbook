import {
  getClusterSubUnit,
  getDelayWindowHours,
  getUserIdTypes,
  isTimedDimension,
} from "shared/experiments";
import {
  getExposureQueryExperimentIdColumn,
  getExposureQueryIdentifierColumn,
  getExposureQueryTimestampColumn,
  getExposureQueryVariationIdColumn,
  getSnapshotCutoffDate,
} from "shared/util";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentUnitsQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

import { MULTIPLE_CLUSTER_SENTINEL } from "back-end/src/integrations/sql/clauses/cluster-assignment-filter";
import { getConversionWindowClause } from "back-end/src/integrations/sql/clauses/conversion-window-clause";
import { getDimensionCTE } from "back-end/src/integrations/sql/ctes/dimension-cte";
import { getDimensionInStatement } from "back-end/src/integrations/sql/fact-metrics/dimension-in-statement";
import { getDimensionValuePerUnit } from "back-end/src/integrations/sql/fact-metrics/dimension-value-per-unit";
import { getTimedUnitDimensionValue } from "back-end/src/integrations/sql/fact-metrics/timed-unit-dimension-value";
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
  getContextualBanditUnitsBaseColumns,
  getContextualBanditUnitsCTEs,
  getContextualBanditUnitsSqlConfig,
} from "back-end/src/integrations/sql/ctes/contextual-bandit-experiment-units-cte";

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

  // Static dims join onto exposures inside the units GROUP BY as always; timed
  // dims need first_exposure_timestamp first, so they join in a wrapper CTE.
  const staticUnitDimensions = unitDimensions.filter(
    (d) => !isTimedDimension(d.dimension),
  );
  const timedUnitDimensions = unitDimensions.filter((d) =>
    isTimedDimension(d.dimension),
  );

  const exposureQuery = unitsSettings.exposureQuery;

  const clusterSubUnit = getClusterSubUnit(unitsSettings);
  const clusterIdColumn = clusterSubUnit ? exposureQuery.identifierType : null;
  const effectiveBaseIdType = clusterSubUnit ?? exposureQuery.identifierType;

  // Dimensions and segments keyed on the cluster column (e.g. region_id) join
  // through the exposure rows directly, so they need no identity join table.
  const isClusterKeyed = (idType: string) => idType === clusterIdColumn;
  const getUnitDimensionIdType = (d: (typeof unitDimensions)[number]) =>
    d.dimension.userIdType || "user_id";
  const segmentIdType = segment ? segment.userIdType || "user_id" : null;

  const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
    dialect,
    datasource.settings,
    {
      objects: [
        [effectiveBaseIdType],
        activationMetric ? getUserIdTypes(activationMetric, factTableMap) : [],
        ...unitDimensions
          .map(getUnitDimensionIdType)
          .filter((idType) => !isClusterKeyed(idType))
          .map((idType) => [idType]),
        segmentIdType && !isClusterKeyed(segmentIdType) ? [segmentIdType] : [],
      ],
      from: unitsSettings.startDate,
      to: unitsSettings.endDate,
      forcedBaseIdType: effectiveBaseIdType,
      experimentId: unitsSettings.experimentId,
    },
  );

  const getUnitDimensionJoinIdType = (
    d: (typeof unitDimensions)[number],
  ): string => {
    const idType = getUnitDimensionIdType(d);
    return isClusterKeyed(idType) ? idType : baseIdType;
  };
  const segmentJoinIdType =
    segmentIdType && isClusterKeyed(segmentIdType) ? segmentIdType : baseIdType;

  const startDate: Date = unitsSettings.startDate;
  const endDate: Date = getExperimentEndDate(unitsSettings, 0);

  // __experimentExposures reads the mapped columns and aliases them to the
  // standard names, so every CTE after it reads e.timestamp
  const rawTimestampColumn = `e.${getExposureQueryTimestampColumn(exposureQuery)}`;
  const timestampColumn = "e.timestamp";
  const overrideConversionWindows =
    unitsSettings.attributionModel === "experimentDuration" ||
    unitsSettings.attributionModel === "lookbackOverride";

  const contextualBanditCfg = getContextualBanditUnitsSqlConfig(unitsSettings);

  const isContextualBandit = !!unitsSettings.banditSettings?.contextualBandit;

  // Contextual bandits attribute each user to their first exposure (one unit per
  // user), so multi-variation users are never bucketed as '__multiple__'.
  const variationValuePerUnit =
    isContextualBandit || unitsSettings.banditSettings?.useFirstExposure
      ? getFirstVariationValuePerUnit(dialect)
      : dialect.ifElse(
          "count(distinct e.variation) > 1",
          "'__multiple__'",
          "max(e.variation)",
        );

  const contextualExposureSelectCols = contextualBanditCfg
    ? getContextualBanditExposureSelectCols(contextualBanditCfg.aliases)
    : "";
  const contextualBanditRawColumns = contextualBanditCfg
    ? getContextualBanditUnitsBaseColumns(
        dialect,
        contextualBanditCfg.aliases,
        timestampColumn,
      )
    : [];
  // Contextual bandits add CTEs after the units CTE and emit the final
  // __experimentUnits themselves
  const unitsCteName = contextualBanditCfg
    ? "__experimentUnitsBase"
    : "__experimentUnits";
  const coreCteName =
    timedUnitDimensions.length > 0 ? "__experimentUnitsCore" : unitsCteName;

  // Single source of truth for the per-unit columns: the core SELECT, the
  // timed-dimension wrapper and the contextual bandit CTEs all derive from it
  const coreColumns: { alias: string; expr: string }[] = [
    { alias: baseIdType, expr: `e.${baseIdType}` },
    { alias: "variation", expr: variationValuePerUnit },
    {
      alias: "first_exposure_timestamp",
      expr: `MIN(${timestampColumn})`,
    },
    ...(clusterIdColumn
      ? [
          {
            alias: clusterIdColumn,
            expr: dialect.ifElse(
              `count(distinct e.${clusterIdColumn}) > 1`,
              `'${MULTIPLE_CLUSTER_SENTINEL}'`,
              dialect.castToString(`max(e.${clusterIdColumn})`),
            ),
          },
        ]
      : []),
    ...staticUnitDimensions.map((d) => ({
      alias: `dim_unit_${d.dimension.id}`,
      expr: getDimensionValuePerUnit(dialect, d),
    })),
    ...experimentDimensions.map((d) => ({
      alias: `dim_exp_${d.id}`,
      expr: getDimensionValuePerUnit(dialect, d),
    })),
    ...(activationMetric
      ? [
          {
            alias: "first_activation_timestamp",
            expr: `MIN(${dialect.ifElse(
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
            )})`,
          },
        ]
      : []),
    ...contextualBanditRawColumns,
  ];
  const timedColumns = timedUnitDimensions.map((d) => ({
    alias: `dim_unit_${d.dimension.id}`,
    expr: getTimedUnitDimensionValue(
      dialect,
      d.dimension,
      "u.first_exposure_timestamp",
      `__dim_unit_${d.dimension.id}`,
    ),
  }));
  const unitsColumnAliases = [
    ...coreColumns.map((c) => c.alias),
    ...timedColumns.map((c) => c.alias),
  ];

  const timedUnitsCte =
    timedUnitDimensions.length > 0
      ? `, ${unitsCteName} AS (
      -- Resolve time-aware dimensions against each unit's first exposure
      SELECT
        ${coreColumns.map((c) => `u.${c.alias}`).join("\n        , ")}
        ${timedColumns.map((c) => `\n        , ${c.expr} AS ${c.alias}`).join("")}
      FROM
        ${coreCteName} u
        ${timedUnitDimensions
          .map((d) => {
            const joinIdType = getUnitDimensionJoinIdType(d);
            return `
            LEFT JOIN __dim_unit_${d.dimension.id} __dim_unit_${d.dimension.id} ON (
              __dim_unit_${d.dimension.id}.${joinIdType} = u.${joinIdType}
            )
          `;
          })
          .join("\n")}
      GROUP BY
        ${coreColumns.map((c) => `u.${c.alias}`).join(", ")}
    )`
      : "";

  // The bandit CTEs replace the raw attribute columns with bucketed ones
  const contextualBanditRawAliases = new Set(
    contextualBanditRawColumns.map((c) => c.alias),
  );
  const contextualAfterUnitsCtes = contextualBanditCfg
    ? getContextualBanditUnitsCTEs(dialect, {
        aliases: contextualBanditCfg.aliases,
        maxRankedContexts: contextualBanditCfg.maxRankedContexts,
        unitsBaseCteName: unitsCteName,
        baseColumnRefs: unitsColumnAliases
          .filter((alias) => !contextualBanditRawAliases.has(alias))
          .map((alias) => `u.${alias}`)
          .join("\n,"),
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
        e.${getExposureQueryIdentifierColumn(exposureQuery, baseIdType)} as ${baseIdType}
        , ${dialect.castToString(
          `e.${getExposureQueryVariationIdColumn(exposureQuery)}`,
        )} as variation
        , ${dialect.castUserDateCol(rawTimestampColumn)} as timestamp
        ${
          clusterIdColumn
            ? `, e.${getExposureQueryIdentifierColumn(
                exposureQuery,
                clusterIdColumn,
              )} as ${clusterIdColumn}`
            : ""
        }
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
          e.${getExposureQueryExperimentIdColumn(
            exposureQuery,
          )} = '${unitsSettings.experimentId}'
          AND ${rawTimestampColumn} >= ${dialect.toTimestamp(startDate)}
          ${
            endDate
              ? `AND ${rawTimestampColumn} <= ${dialect.toTimestamp(endDate)}`
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
              getSnapshotCutoffDate(unitsSettings),
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
            segmentJoinIdType,
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
            getUnitDimensionJoinIdType(d),
            idJoinMap,
            dialect,
          )})`,
      )
      .join("\n")}
    , ${coreCteName} AS (
      -- One row per user
      SELECT
        ${coreColumns.map((c) => `${c.expr} AS ${c.alias}`).join("\n        , ")}
      FROM
        __experimentExposures e
        ${
          segment
            ? `JOIN __segment s ON (s.${segmentJoinIdType} = e.${segmentJoinIdType})`
            : ""
        }
        ${staticUnitDimensions
          .map((d) => {
            const joinIdType = getUnitDimensionJoinIdType(d);
            return `
            LEFT JOIN __dim_unit_${d.dimension.id} __dim_unit_${d.dimension.id} ON (
              __dim_unit_${d.dimension.id}.${joinIdType} = e.${joinIdType}
            )
          `;
          })
          .join("\n")}
        ${
          activationMetric
            ? `LEFT JOIN __activationMetric a ON (a.${baseIdType} = e.${baseIdType})`
            : ""
        }
      ${segment ? `WHERE s.date <= e.timestamp` : ""}
      GROUP BY
        e.${baseIdType}
    )${timedUnitsCte}${contextualAfterUnitsCtes}`;
}
