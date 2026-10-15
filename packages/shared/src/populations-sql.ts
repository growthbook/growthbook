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

const ANY_ROW: AggregateFilterCondition[] = [{ operator: ">=", value: "1" }];

type StepTest = {
  // No aggregate filter: the step only asks whether any row matched.
  anyRow: boolean;
  sql: (total: string) => string;
  matchesZeroRows: boolean;
  // A unit that passes stays passing as more rows arrive (assuming values
  // aren't negative), so the step settles at the row where it first passed.
  // Otherwise it can only settle when its window ends.
  settlesAtMatch: boolean;
};

function getStepTest(step: PopulationStep): StepTest {
  const explicit = getAggregateConditions(step);
  const conditions = explicit ?? ANY_ROW;
  const filter = (total: string) => conditionsSql(total, conditions);
  const isLowerBound = ({ operator }: AggregateFilterCondition) =>
    operator === ">" || operator === ">=";
  const isUpperBound = ({ operator }: AggregateFilterCondition) =>
    operator === "<" || operator === "<=";
  const matchesZeroRows = step.negation
    ? !acceptsZero(conditions)
    : acceptsZero(conditions);
  const upwardClosed = step.negation
    ? conditions.every(isUpperBound)
    : conditions.every(isLowerBound);
  return {
    anyRow: !explicit,
    sql: step.negation ? (total) => `NOT (${filter(total)})` : filter,
    matchesZeroRows,
    settlesAtMatch: upwardClosed && !matchesZeroRows,
  };
}

// "Doesn't have a row in the last N" has held since the unit's last row before
// the window plus N, so that step also reads rows from before its window.
function tracksLastRowBeforeWindow(
  step: PopulationStep,
  index: number,
): boolean {
  return (
    index > 0 &&
    !!step.negation &&
    !getAggregateConditions(step) &&
    step.windowSettings.type === "lookback"
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
 *
 * `joined_ts` is when the unit qualified: the latest time any step settled.
 * A step that later rows can't undo settles at the row where it first passed.
 * Any other step settles when its window ends: a conversion window's end
 * (units whose window is still open at `asOf` are excluded), the unit's last
 * row plus N for "doesn't have a row in the last N", and `asOf` for other
 * lookbacks. With no window, it settles provisionally at its anchor, or at
 * the row where it first passed when zero rows wouldn't pass.
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
    const own = tracksLastRowBeforeWindow(step, index)
      ? null
      : getLookbackStart(step, asOf);
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

    // BigQuery needs DATETIME for interval arithmetic on the anchors.
    const select = [
      `${unit} AS unit_id`,
      `${dialect.castUserDateCol(timestamp)} AS ts`,
    ];
    if (conditions) {
      const column = step.aggregateFilterColumn ?? "$$count";
      // A NULL total would fail every filter, even ones that accept zero.
      select.push(
        `${
          column === "$$count"
            ? "1"
            : `COALESCE(${getColumnExpression(
                column,
                factTable,
                dialect.jsonExtract,
                "",
                dialect.identifierQuote,
              )}, 0)`
        } AS value`,
      );
    }
    // NOT IN returns nothing when its list contains a NULL.
    const where = [
      `${unit} IS NOT NULL`,
      ...getRowFilterConditions(step, factTable, dialect),
    ];
    const lookbackStart = tracksLastRowBeforeWindow(step, index)
      ? null
      : getLookbackStart(step, asOf);
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

  // Typed, since a bare string literal in a CASE with timestamps can make the
  // result a string on some engines.
  const asOfSql = dialect.castUserDateCol(
    dialect.castToTimestamp(dialect.toTimestamp(asOf)),
  );

  steps.forEach((step, index) => {
    const rowsTable = `__pop_step${index}_rows`;
    const prevTable = `__pop_step${index - 1}`;
    const aggTable = `__pop_step${index}_agg`;
    const test = getStepTest(step);
    const lastRow = tracksLastRowBeforeWindow(step, index);
    const { type, windowValue, windowUnit } = step.windowSettings;
    const windowLength = windowSeconds(windowValue, windowUnit);

    let source = `FROM ${rowsTable} r`;
    let carried: string[] = [];
    let anchor = "a.match_ts";
    if (index > 0) {
      carried = recordedTsColumns(index).reverse();
      anchor = coalesce(carried.map((c) => `p.${c}`).reverse());
      // Older ClickHouse versions only allow equality in ON.
      const window: string[] = [];
      if (type === "conversion") {
        const delay = delaySeconds(step);
        window.push(`r.ts >= ${shift(dialect, anchor, delay)}`);
        window.push(`r.ts <= ${shift(dialect, anchor, delay + windowLength)}`);
      } else {
        window.push(`r.ts >= ${anchor}`);
      }
      source = `FROM ${prevTable} p\n        JOIN ${rowsTable} r ON (r.unit_id = p.unit_id)\n        WHERE ${window.join("\n          AND ")}`;
    }

    // The row where the step's test is first met. MAX(ts) only applies when
    // the total passes but no running total did, which takes negative values.
    const needsRunningTotal =
      !test.anyRow && !lastRow && (!step.negation || !test.matchesZeroRows);
    if (lastRow) {
      const windowStart = dialect.toTimestamp(
        getLookbackStart(step, asOf) ?? asOf,
      );
      ctes.push({
        name: aggTable,
        sql: `
        SELECT
          r.unit_id,
          SUM(CASE WHEN r.ts >= ${windowStart} THEN 1 ELSE 0 END) AS total,
          MAX(CASE WHEN r.ts < ${windowStart} THEN r.ts END) AS last_ts
        ${source}
        GROUP BY r.unit_id
      `,
      });
    } else if (needsRunningTotal) {
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
      ctes.push({
        name: aggTable,
        sql: `
        SELECT
          unit_id,
          SUM(value) AS total,
          COALESCE(
            MIN(CASE WHEN ${test.sql("running_total")} THEN ts END),
            MAX(ts)
          ) AS match_ts
        FROM ${runningTable}
        GROUP BY unit_id
      `,
      });
    } else {
      const columns = ["r.unit_id"];
      if (!step.negation) columns.push("MIN(r.ts) AS match_ts");
      else if (!test.anyRow) columns.push("SUM(r.value) AS total");
      ctes.push({
        name: aggTable,
        sql: `
        SELECT ${columns.join(", ")}
        ${source}
        GROUP BY r.unit_id
      `,
      });
    }

    // When the step settled for each unit; see getPopulationMembersCTEs.
    let qualifiedWithRows = "a.match_ts";
    let qualifiedWithoutRows = anchor;
    const pending: string[] = [];
    if (!test.settlesAtMatch) {
      if (type === "conversion") {
        const windowEnd = shift(
          dialect,
          anchor,
          delaySeconds(step) + windowLength,
        );
        qualifiedWithRows = qualifiedWithoutRows = windowEnd;
        pending.push(`${windowEnd} <= ${asOfSql}`);
      } else if (lastRow) {
        qualifiedWithRows = shift(dialect, "a.last_ts", windowLength);
      } else if (type === "lookback") {
        qualifiedWithRows = qualifiedWithoutRows = asOfSql;
      } else if (test.matchesZeroRows) {
        qualifiedWithRows = anchor;
      }
    }

    const rowsTest = lastRow
      ? "a.total = 0"
      : test.anyRow
        ? null
        : test.sql("a.total");

    if (index === 0) {
      ctes.push({
        name: "__pop_step0",
        sql: `
        SELECT
          a.unit_id,
          a.match_ts AS ${tsColumn(0)},
          ${qualifiedWithRows} AS qualified_ts
        FROM ${aggTable} a
        ${rowsTest ? `WHERE ${rowsTest}` : ""}
      `,
      });
      return;
    }

    const select = (stepTs: string | null, qualified: string) =>
      [
        "p.unit_id",
        ...carried.map((c) => `p.${c}`),
        ...(stepTs === null ? [] : [`${stepTs} AS ${tsColumn(index)}`]),
        `CASE WHEN ${qualified} > p.qualified_ts THEN ${qualified} ELSE p.qualified_ts END AS qualified_ts`,
      ].join(",\n          ");
    const nullTs = step.negation
      ? null
      : dialect.castUserDateCol(dialect.castToTimestamp("NULL"));

    const branches: string[] = [];
    if (!step.negation || !test.anyRow || lastRow) {
      const where = [...(rowsTest ? [rowsTest] : []), ...pending];
      branches.push(`
        SELECT
          ${select(step.negation ? null : "a.match_ts", qualifiedWithRows)}
        FROM ${prevTable} p
        JOIN ${aggTable} a ON (a.unit_id = p.unit_id)
        ${where.length ? `WHERE ${where.join("\n          AND ")}` : ""}`);
    }
    if (test.matchesZeroRows) {
      branches.push(`
        SELECT
          ${select(nullTs, qualifiedWithoutRows)}
        FROM ${prevTable} p
        WHERE ${[`p.unit_id NOT IN (SELECT unit_id FROM ${aggTable})`, ...pending].join("\n          AND ")}`);
    }
    ctes.push({
      name: `__pop_step${index}`,
      sql: `${branches.join("\n        UNION ALL")}
      `,
    });
  });

  ctes.push({
    name: POPULATION_MEMBERS_TABLE,
    sql: `
        SELECT unit_id AS ${idType}, qualified_ts AS joined_ts
        FROM __pop_step${steps.length - 1}
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
