import {
  getColumnExpression,
  getColumnRefWhereClause,
  getFactTableIdColumnExpression,
  getFactTableTemplateVariables,
  getFactTableTimestampColumn,
} from "shared/experiments";
import { getPopulationAggregateConditions } from "shared/populations";
import { format } from "shared/sql";
import type { DataSourceType } from "shared/types/datasource";
import type { FactTableInterface, FactTableMap } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import type { PopulationStep } from "shared/validators";
import { compileSqlTemplate } from "back-end/src/util/sql";
import {
  getPopulationMembershipEndDate,
  isWholeUtcDay,
  PopulationMembershipPoint,
} from "back-end/src/integrations/sql/dates/population-membership-points";

// The membership query uses a running total, so it needs window functions.
export const POPULATION_SUPPORTED_DATASOURCE_TYPES: readonly DataSourceType[] =
  [
    "postgres",
    "clickhouse",
    "growthbook_clickhouse",
    "bigquery",
    "snowflake",
    "athena",
    "presto",
    "databricks",
    "redshift",
  ];

export function isPopulationSupportedDatasourceType(
  type: DataSourceType,
): boolean {
  return POPULATION_SUPPORTED_DATASOURCE_TYPES.includes(type);
}

export type PopulationMembershipQueryParams = {
  steps: PopulationStep[];
  userIdType: string;
  factTableMap: FactTableMap;
  points: PopulationMembershipPoint[];
};

// Members and joined at every point in one scan of the fact table: find the
// day each unit joined, count joins per day, then sum those counts per point.
// TODO: Units are assumed to stay members once they join, so left is always 0.
// Aggregate filters with an upper bound (<, <=, =, !=, ranges) or columns with
// negative values let units leave, and need a separate path that tracks every
// change in membership.
export function getPopulationMembershipQuery(
  dialect: SqlDialect,
  { steps, userIdType, factTableMap, points }: PopulationMembershipQueryParams,
): string {
  const step = steps[0];
  if (!step) {
    throw new Error("At least one population step is required");
  }
  const factTable = factTableMap.get(step.source.factTableId);
  if (!factTable) {
    throw new Error(`Unknown fact table: ${step.source.factTableId}`);
  }
  validatePopulationStep(step, factTable);

  // Joins are counted per day, so a date partway through a day would count
  // that whole day.
  const misaligned = points
    .flatMap((p) => [p.asOf, p.prevAsOf])
    .find((d) => !isWholeUtcDay(d));
  if (misaligned) {
    throw new Error(
      `Membership dates must start on a whole day: ${misaligned.toISOString()}`,
    );
  }

  const endDate = getPopulationMembershipEndDate(points);
  const timestampColumn = getFactTableTimestampColumn(factTable);
  const unit = getFactTableIdColumnExpression(factTable, userIdType, dialect);
  const day = dialect.dateTrunc(timestampColumn, "day");

  const where = [
    `${timestampColumn} < ${dialect.toTimestamp(endDate)}`,
    ...getColumnRefWhereClause({
      factTable,
      columnRef: {
        factTableId: factTable.id,
        column: "",
        rowFilters: step.rowFilters,
      },
      escapeStringLiteral: dialect.escapeStringLiteral,
      stringMatch: dialect.stringMatch,
      jsonExtract: dialect.jsonExtract,
      evalBoolean: dialect.evalBoolean,
      castToTimestamp: dialect.castToTimestamp,
      identifierQuote: dialect.identifierQuote,
    }),
  ];

  const aggregateConditions = getPopulationAggregateConditions(step);

  return format(
    `
-- Population membership
WITH
__points AS (
  ${points
    .map(
      (p) =>
        `SELECT '${dialect.escapeStringLiteral(p.id)}' AS point_id, ${dialect.toTimestamp(p.asOf)} AS as_of, ${dialect.toTimestamp(p.prevAsOf)} AS prev_as_of`,
    )
    .join("\n  UNION ALL\n  ")}
),
__factTable AS (
  SELECT * FROM (
    ${compileSqlTemplate(
      factTable.sql,
      {
        // Every earlier row can qualify a unit, so there's no start date.
        startDate: new Date(0),
        endDate,
        templateVariables: getFactTableTemplateVariables(factTable),
      },
      dialect,
    )}
  ) t
  WHERE ${where.join("\n    AND ")}
),
${
  aggregateConditions.length
    ? getRunningTotalJoinsCTEs(dialect, {
        step,
        factTable,
        unit,
        day,
        conditions: aggregateConditions.map(
          ({ operator, value }) => `running_total ${operator} ${value}`,
        ),
      })
    : getFirstMatchJoinsCTE({ unit, day })
},
__joinCounts AS (
  SELECT joined_at, COUNT(*) AS units
  FROM __joins
  GROUP BY joined_at
)
SELECT
  p.point_id AS point_id,
  SUM(j.units) AS members_count,
  SUM(CASE WHEN j.joined_at >= p.prev_as_of THEN j.units ELSE 0 END) AS joined_count,
  0 AS left_count
FROM __points p
JOIN __joinCounts j ON j.joined_at < p.as_of
GROUP BY p.point_id
  `,
    dialect.formatDialect,
  );
}

function validatePopulationStep(
  step: PopulationStep,
  factTable: FactTableInterface,
) {
  if (step.windowSettings.type === "lookback") {
    throw new Error("Populations don't support lookback windows yet");
  }
  // Row filter SQL skips a saved filter it can't find, which would silently
  // widen the Population.
  const missingSavedFilter = step.rowFilters?.find(
    (rf) =>
      rf.operator === "saved_filter" &&
      !factTable.filters.some((f) => f.id === rf.values?.[0]),
  );
  if (missingSavedFilter) {
    throw new Error(`Unknown saved filter: ${missingSavedFilter.values?.[0]}`);
  }
}

// A unit joins on its first matching day.
function getFirstMatchJoinsCTE({
  unit,
  day,
}: {
  unit: string;
  day: string;
}): string {
  return `__joins AS (
  SELECT ${unit} AS unit, MIN(${day}) AS joined_at
  FROM __factTable
  GROUP BY ${unit}
)`;
}

// A unit joins on the first day its running total passes the aggregate filter.
// "$$count" counts rows; any other column is summed.
function getRunningTotalJoinsCTEs(
  dialect: SqlDialect,
  {
    step,
    factTable,
    unit,
    day,
    conditions,
  }: {
    step: PopulationStep;
    factTable: FactTableInterface;
    unit: string;
    day: string;
    conditions: string[];
  },
): string {
  const value =
    step.aggregateFilterColumn === "$$count"
      ? "1"
      : getColumnExpression(
          step.aggregateFilterColumn ?? "",
          factTable,
          dialect.jsonExtract,
          "",
          dialect.identifierQuote,
        );

  return `__unitDays AS (
  SELECT ${unit} AS unit, ${day} AS bucket, SUM(${value}) AS agg_value
  FROM __factTable
  GROUP BY ${unit}, ${day}
),
__runningTotals AS (
  SELECT
    unit,
    bucket,
    SUM(agg_value) OVER (PARTITION BY unit ORDER BY bucket) AS running_total
  FROM __unitDays
),
__joins AS (
  SELECT unit, MIN(bucket) AS joined_at
  FROM __runningTotals
  WHERE ${conditions.join("\n    AND ")}
  GROUP BY unit
)`;
}
