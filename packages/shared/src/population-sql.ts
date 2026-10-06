import type { PopulationStep } from "shared/validators";
import type { FactTableInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import { format } from "./sql";
import {
  getColumnExpression,
  getDelayWindowHours,
  getFactTableIdColumnExpression,
  getFactTableTimestampColumn,
  getMetricWindowHours,
  getRowFilterSQL,
} from "./experiments/experiments";

export const POPULATION_COMPARISON_DAYS = 30;

export type PopulationSqlFactTable = Pick<
  FactTableInterface,
  | "id"
  | "sql"
  | "columns"
  | "filters"
  | "userIdTypes"
  | "userIdColumns"
  | "timestampColumn"
>;

export type PopulationSqlParams = {
  steps: PopulationStep[];
  userIdType: string;
  // Fact table SQL must already have its template variables compiled.
  factTableMap: Map<string, PopulationSqlFactTable>;
  dialect: SqlDialect;
  asOf: Date;
  comparisonDays?: number;
};

export type PopulationSnapshotCounts = {
  membersNow: number;
  membersPrior: number;
  joined: number;
  left: number;
};

type AggregateCondition = { operator: string; value: string };

const AGGREGATE_CONDITION_REGEX = /^(=|!=|<>|<=|<|>=|>)(\d+(\.\d+)?)$/;

export function parsePopulationAggregateFilter(
  aggregateFilter: string,
): AggregateCondition[] {
  return aggregateFilter
    .replace(/\s*/g, "")
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const match = part.match(AGGREGATE_CONDITION_REGEX);
      if (!match) throw new Error(`Invalid aggregate filter: ${part}`);
      return { operator: match[1], value: match[2] };
    });
}

function addHours(dialect: SqlDialect, col: string, hours: number): string {
  if (!hours) return col;
  const sign = hours > 0 ? "+" : "-";
  const minutes = Math.round(Math.abs(hours) * 60);
  return minutes % 60
    ? dialect.addTime(col, "minute", sign, minutes)
    : dialect.addTime(col, "hour", sign, minutes / 60);
}

function timestampLiteral(dialect: SqlDialect, date: Date): string {
  return dialect.castToTimestamp(dialect.toTimestamp(date));
}

function getStepValueExpression(
  step: PopulationStep,
  factTable: PopulationSqlFactTable,
  dialect: SqlDialect,
): string {
  const column = step.aggregateFilterColumn;
  if (!step.aggregateFilter || !column || column === "$$count") return "1";
  return getColumnExpression(
    column,
    factTable,
    dialect.jsonExtract,
    "",
    dialect.identifierQuote,
  );
}

// Lower-bound filters (">", ">=") are satisfied the moment the running total
// first crosses them; anything else can only be judged on the window's total.
function isCrossingAggregate(conditions: AggregateCondition[]): boolean {
  return conditions.every((c) => c.operator === ">" || c.operator === ">=");
}

export function buildPopulationSql({
  steps,
  userIdType,
  factTableMap,
  dialect,
  asOf,
  comparisonDays = POPULATION_COMPARISON_DAYS,
}: PopulationSqlParams): string {
  if (!steps.length) throw new Error("Populations require at least 1 step");
  if (steps[0].windowSettings.type === "conversion") {
    throw new Error("The first step cannot use a conversion window");
  }

  const priorAsOf = new Date(asOf.getTime() - comparisonDays * 86400000);
  const ctes: { name: string; sql: string }[] = [
    {
      name: "__pop_as_of",
      sql: `SELECT 0 AS period, ${timestampLiteral(dialect, asOf)} AS as_of
UNION ALL
SELECT 1 AS period, ${timestampLiteral(dialect, priorAsOf)} AS as_of`,
    },
  ];

  steps.forEach((step, i) => {
    const n = i + 1;
    const factTable = factTableMap.get(step.source.factTableId);
    if (!factTable) {
      throw new Error(`Fact table ${step.source.factTableId} not found`);
    }
    if (!factTable.userIdTypes.includes(userIdType)) {
      throw new Error(
        `Fact table ${factTable.id} does not support identifier type ${userIdType}`,
      );
    }

    const timestamp = getFactTableTimestampColumn(factTable);
    const rowFilters = step.rowFilters
      .map((rowFilter) =>
        getRowFilterSQL({
          rowFilter,
          factTable,
          escapeStringLiteral: dialect.escapeStringLiteral,
          stringMatch: dialect.stringMatch,
          jsonExtract: dialect.jsonExtract,
          evalBoolean: dialect.evalBoolean,
          castToTimestamp: dialect.castToTimestamp,
          identifierQuote: dialect.identifierQuote,
        }),
      )
      .filter((sql): sql is string => sql !== null);

    ctes.push({
      name: `__pop_s${n}_events`,
      sql: `SELECT
  ${getFactTableIdColumnExpression(factTable, userIdType, dialect)} AS unit_id,
  ${timestamp} AS ts,
  ${getStepValueExpression(step, factTable, dialect)} AS value
FROM (
  ${factTable.sql}
) t
WHERE ${[`${timestamp} <= ${timestampLiteral(dialect, asOf)}`, ...rowFilters.map((f) => `(${f})`)].join("\n  AND ")}`,
    });

    const { windowSettings } = step;
    const conditions = ["e.ts <= p.as_of"];
    if (windowSettings.type === "lookback") {
      conditions.push(
        `e.ts > ${addHours(dialect, "p.as_of", -getMetricWindowHours(windowSettings))}`,
      );
    }
    let from: string;
    if (i === 0) {
      from = `__pop_s${n}_events e\nCROSS JOIN __pop_as_of p`;
    } else {
      from = `__pop_s${n - 1} p\nJOIN __pop_s${n}_events e ON e.unit_id = p.unit_id`;
      const delayHours =
        windowSettings.type === "conversion"
          ? getDelayWindowHours(windowSettings)
          : 0;
      conditions.push(`e.ts >= ${addHours(dialect, "p.step_ts", delayHours)}`);
      if (windowSettings.type === "conversion") {
        conditions.push(
          `e.ts <= ${addHours(
            dialect,
            "p.step_ts",
            delayHours + getMetricWindowHours(windowSettings),
          )}`,
        );
      }
    }
    ctes.push({
      name: `__pop_s${n}_rows`,
      // Explicit aliases: ClickHouse keeps the `e.` prefix on joined columns.
      sql: `SELECT
  p.period AS period,
  p.as_of AS as_of,
  e.unit_id AS unit_id,
  e.ts AS ts,
  e.value AS value
FROM ${from}
WHERE ${conditions.join("\n  AND ")}`,
    });

    const aggregate = step.aggregateFilter
      ? parsePopulationAggregateFilter(step.aggregateFilter)
      : [];
    const groupBy = "GROUP BY period, as_of, unit_id";
    if (!aggregate.length) {
      ctes.push({
        name: `__pop_s${n}`,
        sql: `SELECT period, as_of, unit_id, MIN(ts) AS step_ts
FROM __pop_s${n}_rows
${groupBy}`,
      });
    } else if (isCrossingAggregate(aggregate)) {
      ctes.push({
        name: `__pop_s${n}_running`,
        sql: `SELECT
  period,
  as_of,
  unit_id,
  ts,
  SUM(value) OVER (
    PARTITION BY period, unit_id
    ORDER BY ts
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_value
FROM __pop_s${n}_rows`,
      });
      ctes.push({
        name: `__pop_s${n}`,
        sql: `SELECT period, as_of, unit_id, MIN(ts) AS step_ts
FROM __pop_s${n}_running
WHERE ${aggregate.map((c) => `running_value ${c.operator} ${c.value}`).join(" AND ")}
${groupBy}`,
      });
    } else {
      ctes.push({
        name: `__pop_s${n}`,
        sql: `SELECT period, as_of, unit_id, MAX(ts) AS step_ts
FROM __pop_s${n}_rows
${groupBy}
HAVING ${aggregate.map((c) => `SUM(value) ${c.operator} ${c.value}`).join(" AND ")}`,
      });
    }
  });

  ctes.push({
    name: "__pop_members",
    sql: `SELECT
  unit_id,
  MAX(CASE WHEN period = 0 THEN 1 ELSE 0 END) AS in_now,
  MAX(CASE WHEN period = 1 THEN 1 ELSE 0 END) AS in_prior
FROM __pop_s${steps.length}
GROUP BY unit_id`,
  });

  return format(
    `WITH
${ctes.map((c) => `${c.name} AS (\n${c.sql}\n)`).join(",\n")}
SELECT
  SUM(in_now) AS members_now,
  SUM(in_prior) AS members_prior,
  SUM(CASE WHEN in_now = 1 AND in_prior = 0 THEN 1 ELSE 0 END) AS units_joined,
  SUM(CASE WHEN in_now = 0 AND in_prior = 1 THEN 1 ELSE 0 END) AS units_left
FROM __pop_members`,
    dialect.formatDialect,
  );
}

function toCount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function parsePopulationSnapshotRows(
  rows: Record<string, unknown>[],
): PopulationSnapshotCounts {
  const row = rows[0] ?? {};
  return {
    membersNow: toCount(row.members_now),
    membersPrior: toCount(row.members_prior),
    joined: toCount(row.units_joined),
    left: toCount(row.units_left),
  };
}
