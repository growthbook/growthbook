import type { PopulationInterface, PopulationStep } from "shared/validators";
import { buildMinimalOrCondition, format } from "shared/sql";
import { conversionWindowToSeconds } from "shared/funnels";
import type { FactTableInterface, FactTableMap } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import {
  getColumnExpression,
  getFactTableIdColumnExpression,
  getFactTableTimestampColumn,
  getRowFilterSQL,
} from "./experiments/experiments";
import {
  AggregateFilterCondition,
  parseAggregateFilter,
} from "./aggregate-filters";
import {
  getPopulationFactTableIds,
  getPopulationRuleViolations,
  getPopulationStepAnchorIndex,
} from "./populations";

/** One row per member: the identifier type's column plus `joined_ts`. */
export const POPULATION_MEMBERS_TABLE = "__population_members";

export type PopulationCTE = { name: string; sql: string };

export type PopulationSqlParams = {
  population: Pick<PopulationInterface, "datasource" | "userIdTypes" | "steps">;
  factTableMap: FactTableMap;
  dialect: SqlDialect;
  idType: string;
  // Rows after this are ignored, and lookback windows end here.
  asOf: Date;
};

const RUNNING_TOTAL_FRAME = "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW";

function windowSeconds(
  value: number,
  unit: PopulationStep["windowSettings"]["windowUnit"],
) {
  return conversionWindowToSeconds({ value, unit });
}

// Unlike windows, delays can be zero or negative.
function delaySeconds(step: PopulationStep): number {
  const { delayValue, delayUnit } = step.windowSettings;
  return Math.round(
    delayValue * conversionWindowToSeconds({ value: 1, unit: delayUnit }),
  );
}

function shift(dialect: SqlDialect, expr: string, seconds: number): string {
  if (!seconds) return expr;
  return dialect.addIntervalSeconds(
    expr,
    seconds > 0 ? "+" : "-",
    Math.abs(seconds),
  );
}

function getLookbackStart(step: PopulationStep, asOf: Date): Date | null {
  const { type, windowValue, windowUnit } = step.windowSettings;
  if (type !== "lookback") return null;
  return new Date(
    asOf.getTime() - windowSeconds(windowValue, windowUnit) * 1000,
  );
}

function compare(a: number, operator: string, b: number): boolean {
  switch (operator) {
    case "=":
      return a === b;
    case "!=":
    case "<>":
      return a !== b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    default:
      throw new Error(`Unknown aggregate filter operator "${operator}"`);
  }
}

function getAggregateConditions(
  step: PopulationStep,
): AggregateFilterCondition[] | null {
  if (!step.aggregateFilter || !step.aggregateFilterColumn) return null;
  return parseAggregateFilter(step.aggregateFilter).conditions;
}

function conditionsSql(
  expr: string,
  conditions: AggregateFilterCondition[],
): string {
  return conditions
    .map(
      ({ operator, value }) =>
        `${expr} ${operator === "!=" ? "<>" : operator} ${value}`,
    )
    .join(" AND ");
}

// A filter such as "<3" also matches units with no rows at all.
function acceptsZero(conditions: AggregateFilterCondition[]): boolean {
  return conditions.every(({ operator, value }) =>
    compare(0, operator, Number(value)),
  );
}

function getRowFilterConditions(
  step: PopulationStep,
  factTable: FactTableInterface,
  dialect: SqlDialect,
): string[] {
  return step.rowFilters
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
}

const tsColumn = (stepIndex: number) => `s${stepIndex}_ts`;

/**
 * CTEs that resolve a Population's members, ending in
 * `POPULATION_MEMBERS_TABLE`.
 *
 * Each step joins its fact table rows to the units still in the Population
 * and keeps the units that match. A matching "has" step records the timestamp
 * it matched at: its earliest row, or with an aggregate filter, the row where
 * the running total first meets the filter. Later steps must happen at or
 * after the nearest earlier recorded timestamp, which also anchors conversion
 * windows. A "has" step whose filter also matches zero rows (such as "<3")
 * keeps units with no rows but records no timestamp for them. Negated steps
 * keep units the step would not match, and never record a timestamp.
 */
export function getPopulationMembersCTEs({
  population,
  factTableMap,
  dialect,
  idType,
  asOf,
}: PopulationSqlParams): PopulationCTE[] {
  const { steps } = population;
  if (!population.userIdTypes.includes(idType)) {
    throw new Error(
      `Identifier type "${idType}" is not one of this Population's identifier types.`,
    );
  }

  const factTableIds = getPopulationFactTableIds(steps);
  const factTables = factTableIds.flatMap((id) => {
    const factTable = factTableMap.get(id);
    return factTable ? [factTable] : [];
  });
  const violations = getPopulationRuleViolations({
    datasource: population.datasource,
    userIdTypes: population.userIdTypes,
    steps,
    factTables,
  });
  if (violations.length) {
    throw new Error(violations.join(" "));
  }
  const getFactTable = (id: string): FactTableInterface => {
    const factTable = factTableMap.get(id);
    if (!factTable) throw new Error(`Fact table ${id} not found.`);
    return factTable;
  };

  // Every later step's rows are at or after step 1's timestamp, so step 1's
  // lookback bounds them too, unless a negative delay reaches back before it.
  const firstStepStart = getLookbackStart(steps[0], asOf);
  const hasNegativeDelay = steps.some(
    (s) => s.windowSettings.type === "conversion" && delaySeconds(s) < 0,
  );
  const getEarliestRow = (step: PopulationStep, index: number) => {
    const own = getLookbackStart(step, asOf);
    if (index === 0 || hasNegativeDelay) return own;
    if (!own || !firstStepStart) return own ?? firstStepStart;
    return own > firstStepStart ? own : firstStepStart;
  };

  const ctes: PopulationCTE[] = [];

  factTableIds.forEach((factTableId, i) => {
    const factTable = getFactTable(factTableId);
    const timestamp = getFactTableTimestampColumn(factTable);
    const tableSteps = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.source.factTableId === factTableId);

    const where = [`${timestamp} <= ${dialect.toTimestamp(asOf)}`];
    const earliestRows = tableSteps.map(({ step, index }) =>
      getEarliestRow(step, index),
    );
    if (earliestRows.every((d): d is Date => d !== null)) {
      const earliest = new Date(
        Math.min(...earliestRows.map((d) => d.getTime())),
      );
      where.push(`${timestamp} >= ${dialect.toTimestamp(earliest)}`);
    }
    // Rows no step on this fact table can match are dropped at the scan.
    const pushdown = buildMinimalOrCondition(
      tableSteps.map(({ step }) =>
        getRowFilterConditions(step, factTable, dialect),
      ),
    );
    if (pushdown) where.push(pushdown);

    ctes.push({
      name: `__pop_ft${i}`,
      sql: `
        SELECT * FROM (
          -- Fact Table (${factTable.name})
          ${factTable.sql}
        ) t
        WHERE ${where.join("\n          AND ")}
      `,
    });
  });

  steps.forEach((step, index) => {
    const factTable = getFactTable(step.source.factTableId);
    const timestamp = getFactTableTimestampColumn(factTable);
    const unit = getFactTableIdColumnExpression(factTable, idType, dialect);
    const conditions = getAggregateConditions(step);

    const select = [`${unit} AS unit_id`, `${timestamp} AS ts`];
    if (conditions) {
      const column = step.aggregateFilterColumn ?? "$$count";
      select.push(
        `${
          column === "$$count"
            ? "1"
            : getColumnExpression(
                column,
                factTable,
                dialect.jsonExtract,
                "",
                dialect.identifierQuote,
              )
        } AS value`,
      );
    }
    // NOT IN returns nothing when its list contains a NULL.
    const where = [
      `${unit} IS NOT NULL`,
      ...getRowFilterConditions(step, factTable, dialect),
    ];
    const lookbackStart = getLookbackStart(step, asOf);
    if (lookbackStart) {
      where.push(`${timestamp} >= ${dialect.toTimestamp(lookbackStart)}`);
    }
    ctes.push({
      name: `__pop_step${index}_rows`,
      sql: `
        SELECT
          ${select.join(",\n          ")}
        FROM __pop_ft${factTableIds.indexOf(step.source.factTableId)}
        WHERE ${where.join("\n          AND ")}
      `,
    });
  });

  // Earlier steps' recorded timestamps, latest step first.
  const recordedTsColumns = (beforeIndex: number): string[] => {
    const columns: string[] = [];
    for (
      let i = getPopulationStepAnchorIndex(steps, beforeIndex);
      i !== null;
      i = getPopulationStepAnchorIndex(steps, i)
    ) {
      columns.push(tsColumn(i));
    }
    return columns;
  };
  const coalesce = (columns: string[]) =>
    columns.length === 1 ? columns[0] : `COALESCE(${columns.join(", ")})`;

  steps.forEach((step, index) => {
    const rowsTable = `__pop_step${index}_rows`;
    const prevTable = `__pop_step${index - 1}`;
    const aggTable = `__pop_step${index}_agg`;
    const conditions = getAggregateConditions(step);

    let source = `FROM ${rowsTable} r`;
    let carried: string[] = [];
    if (index > 0) {
      carried = recordedTsColumns(index).reverse();
      const anchor = coalesce(carried.map((c) => `p.${c}`).reverse());
      const join = [`r.unit_id = p.unit_id`];
      const { type, windowValue, windowUnit } = step.windowSettings;
      if (type === "conversion") {
        const delay = delaySeconds(step);
        join.push(`r.ts >= ${shift(dialect, anchor, delay)}`);
        join.push(
          `r.ts <= ${shift(dialect, anchor, delay + windowSeconds(windowValue, windowUnit))}`,
        );
      } else {
        join.push(`r.ts >= ${anchor}`);
      }
      source = `FROM ${prevTable} p\n        JOIN ${rowsTable} r ON (\n          ${join.join("\n          AND ")}\n        )`;
    }

    if (step.negation) {
      ctes.push({
        name: aggTable,
        sql: `
        SELECT r.unit_id${conditions ? ", SUM(r.value) AS total" : ""}
        ${source}
        GROUP BY r.unit_id
      `,
      });
      // The step "would match" a unit with no rows when its filter accepts
      // zero, so only units whose total fails the filter are kept.
      const membership = !conditions
        ? `NOT IN (SELECT unit_id FROM ${aggTable})`
        : acceptsZero(conditions)
          ? `IN (SELECT unit_id FROM ${aggTable} WHERE NOT (${conditionsSql("total", conditions)}))`
          : `NOT IN (SELECT unit_id FROM ${aggTable} WHERE ${conditionsSql("total", conditions)})`;
      ctes.push({
        name: `__pop_step${index}`,
        sql: `
        SELECT ${["p.unit_id", ...carried.map((c) => `p.${c}`)].join(", ")}
        FROM ${prevTable} p
        WHERE p.unit_id ${membership}
      `,
      });
      return;
    }

    if (conditions) {
      const runningTable = `__pop_step${index}_running`;
      ctes.push({
        name: runningTable,
        sql: `
        SELECT
          r.unit_id,
          r.ts,
          r.value,
          SUM(r.value) OVER (PARTITION BY r.unit_id ORDER BY r.ts ${RUNNING_TOTAL_FRAME}) AS running_total
        ${source}
      `,
      });
      // MAX(ts) only applies when the total meets the filter but no running
      // total did, which takes negative values.
      ctes.push({
        name: aggTable,
        sql: `
        SELECT
          unit_id,
          SUM(value) AS total,
          COALESCE(
            MIN(CASE WHEN ${conditionsSql("running_total", conditions)} THEN ts END),
            MAX(ts)
          ) AS match_ts
        FROM ${runningTable}
        GROUP BY unit_id
      `,
      });
    } else {
      ctes.push({
        name: aggTable,
        sql: `
        SELECT r.unit_id, MIN(r.ts) AS match_ts
        ${source}
        GROUP BY r.unit_id
      `,
      });
    }

    const totalFilter = conditions
      ? `WHERE ${conditionsSql("a.total", conditions)}`
      : "";
    if (index === 0) {
      ctes.push({
        name: "__pop_step0",
        sql: `
        SELECT a.unit_id, a.match_ts AS ${tsColumn(0)}
        FROM ${aggTable} a
        ${totalFilter}
      `,
      });
      return;
    }

    const carriedSelect = ["p.unit_id", ...carried.map((c) => `p.${c}`)];
    const zeroRows =
      conditions && acceptsZero(conditions)
        ? `
        UNION ALL
        SELECT ${[...carriedSelect, `${dialect.castToTimestamp("NULL")} AS ${tsColumn(index)}`].join(", ")}
        FROM ${prevTable} p
        WHERE p.unit_id NOT IN (SELECT unit_id FROM ${aggTable})`
        : "";
    ctes.push({
      name: `__pop_step${index}`,
      sql: `
        SELECT ${[...carriedSelect, `a.match_ts AS ${tsColumn(index)}`].join(", ")}
        FROM ${prevTable} p
        JOIN ${aggTable} a ON (a.unit_id = p.unit_id)
        ${totalFilter}${zeroRows}
      `,
    });
  });

  const lastIndex = steps.length - 1;
  const joinedColumns = [
    ...(steps[lastIndex].negation ? [] : [tsColumn(lastIndex)]),
    ...recordedTsColumns(lastIndex),
  ];
  ctes.push({
    name: POPULATION_MEMBERS_TABLE,
    sql: `
        SELECT unit_id AS ${idType}, ${coalesce(joinedColumns)} AS joined_ts
        FROM __pop_step${lastIndex}
      `,
  });

  return ctes;
}

export function buildPopulationSizeSql(params: PopulationSqlParams): string {
  const ctes = getPopulationMembersCTEs(params);
  return format(
    `
    WITH
      ${ctes.map((c) => `${c.name} AS (${c.sql})`).join(",\n      ")}
    SELECT COUNT(*) AS members
    FROM ${POPULATION_MEMBERS_TABLE}
    `,
    params.dialect.formatDialect,
  );
}
