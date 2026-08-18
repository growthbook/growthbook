import { format } from "shared/sql";
import { SqlDialect } from "shared/types/sql";
import { FactTableInterface, FactTableMap } from "shared/types/fact-table";
import { DataSourceType } from "shared/types/datasource";
import { getColumnExpression } from "../../experiments/experiments";
import {
  ExplorationConfig,
  JourneyDataset,
  JourneyStepGroup,
  ProductAnalyticsDimension,
  ProductAnalyticsResult,
} from "../../validators/product-analytics";
import {
  JOURNEY_NONE,
  JOURNEY_OTHER,
  composeStepLabel,
  journeyDimValueCount,
  journeyOptionsAt,
  journeyTerminal,
  stepGroupsForColumn,
  validateJourneyDataset,
  validateJourneyStepColumns,
} from "../../journeys";
import {
  calculateProductAnalyticsDateRange,
  generateDimensionExpression,
  generateDynamicDimensionCTE,
  generateRowFilterSQL,
} from "./sql";

type CTE = { name: string; sql: string };

type FactTableGroup = {
  index: number;
  factTable: Pick<
    FactTableInterface,
    "sql" | "columns" | "filters" | "userIdTypes" | "timestampColumn"
  >;
  metrics: [];
  units: [];
};

function lit(dialect: SqlDialect, value: string): string {
  return `'${dialect.escapeStringLiteral(value)}'`;
}

function parseStringValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function parseNumberValue(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function rowValue(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name];
  const upper = name.toUpperCase();
  if (upper in row) return row[upper];
  const lower = name.toLowerCase();
  if (lower in row) return row[lower];
  return undefined;
}

function columnExpr(
  column: string,
  factTable: Pick<FactTableInterface, "columns">,
  dialect: SqlDialect,
): string {
  return getColumnExpression(
    column,
    factTable,
    dialect.jsonExtract,
    "",
    dialect.identifierQuote,
  );
}

/** String-typed step column with grouping CASE applied. No rules → raw expr. */
function groupedColumnExpr(
  column: string,
  stepGroups: JourneyStepGroup[] | undefined,
  factTable: Pick<FactTableInterface, "columns">,
  dialect: SqlDialect,
): string {
  const raw = dialect.castToString(columnExpr(column, factTable, dialect));
  const rules = stepGroupsForColumn(stepGroups, column);
  if (!rules.length) return raw;
  const whens = rules.map(
    (rule) =>
      `WHEN ${dialect.globMatch(raw, rule.pattern)} THEN ${lit(dialect, rule.pattern)}`,
  );
  return `CASE ${whens.join("\n             ")} ELSE ${raw} END`;
}

function stepExpression(
  stepColumns: string[],
  stepGroups: JourneyStepGroup[] | undefined,
  factTable: Pick<FactTableInterface, "columns">,
  dialect: SqlDialect,
): string {
  const parts = stepColumns.map((col) =>
    groupedColumnExpr(col, stepGroups, factTable, dialect),
  );
  if (parts.length === 1) return parts[0];
  const concatParts: string[] = [];
  parts.forEach((part, i) => {
    if (i > 0) concatParts.push(lit(dialect, " / "));
    concatParts.push(`COALESCE(${part}, '')`);
  });
  return dialect.concatStrings(concatParts);
}

// Journeys are scoped to one unit-day: a session boundary the warehouse can
// derive without a sessionization step.
const JOURNEY_PARTITION = "journey_unit, journey_day";
const JOURNEY_WINDOW = `(PARTITION BY ${JOURNEY_PARTITION} ORDER BY ts)`;
const JOURNEY_CARRY = `${JOURNEY_PARTITION}, ts, step, dim_1`;

/** Shares every rule with the API layer via `validateJourneyDataset`, and adds
 *  the two that need the resolved Fact Table. */
function assertJourneyConfig(
  dataset: JourneyDataset,
  factTable: FactTableInterface | undefined,
  dimension: ProductAnalyticsDimension | undefined,
): asserts factTable is FactTableInterface {
  const errors = validateJourneyDataset(dataset, dimension);
  if (errors.length) {
    throw new Error(errors[0]);
  }
  if (!factTable) {
    throw new Error(`Fact table ${dataset.factTableId} not found`);
  }
  const columnErrors = validateJourneyStepColumns(dataset, factTable);
  if (columnErrors.length) {
    throw new Error(columnErrors[0]);
  }
  if (dataset.unit && !factTable.userIdTypes.includes(dataset.unit)) {
    throw new Error(
      `Journey unit "${dataset.unit}" is not a userIdType on the Fact Table`,
    );
  }
}

function committedPredicate(
  dialect: SqlDialect,
  col: string,
  step: JourneyDataset["path"][number],
): string {
  return `${col} = ${lit(dialect, step.value)}`;
}

function dimMaxValues(dimension: ProductAnalyticsDimension | null): number {
  return journeyDimValueCount(dimension ?? undefined) || 3;
}

/**
 * Collapses `dim_1` to the top-N values plus a single `(other)`.
 *
 * This has to be applied *before* the final GROUP BY. Grouping on the raw
 * column and bucketing in the SELECT emits one row per distinct value, all
 * labeled `(other)` — which fragments the bucket and, worse, makes the real
 * row count scale with dimension cardinality instead of the `dimValues + 1`
 * that `maxJourneyResultRows` budgets for.
 */
function dimBucketSql(dialect: SqlDialect, hasDimension: boolean): string {
  if (!hasDimension) return dialect.castToString("NULL");
  return `CASE WHEN dim_1 IN (SELECT value FROM __journey_top_dim) THEN dim_1 ELSE ${lit(dialect, JOURNEY_OTHER)} END`;
}

function bucketChain(
  dialect: SqlDialect,
  dataset: JourneyDataset,
  srcCte: string,
): { ctes: CTE[]; last: string } {
  const ctes: CTE[] = [];
  const term = journeyTerminal(dataset.direction);
  const pathLen = dataset.path.length;
  const k = dataset.lookaheadDepth;
  let prev = srcCte;

  for (let fi = 0; fi < k; fi++) {
    const n = journeyOptionsAt(dataset.optionsPerStep, pathLen + fi);
    const col = `nb_${pathLen + fi + 1}`;
    const lvl = `lvl_${fi + 1}`;
    const topName = `__journey_top_lvl${fi + 1}`;
    const chainName = `__journey_lvl${fi + 1}`;
    const none = lit(dialect, JOURNEY_NONE);
    const other = lit(dialect, JOURNEY_OTHER);
    const termLit = lit(dialect, term);

    if (fi === 0) {
      ctes.push({
        name: topName,
        sql: `
          SELECT value FROM (
            SELECT ${col} AS value,
              ROW_NUMBER() OVER (ORDER BY c DESC, ${col}) AS rn
            FROM (
              SELECT ${col}, COUNT(*) AS c
              FROM ${prev}
              WHERE ${col} IS NOT NULL
              GROUP BY ${col}
            ) agg
          ) r
          WHERE rn <= ${n}
        `,
      });
      ctes.push({
        name: chainName,
        sql: `
          SELECT s.*,
            CASE WHEN s.${col} IS NULL THEN ${termLit}
                 WHEN s.${col} IN (SELECT value FROM ${topName}) THEN s.${col}
                 ELSE ${other} END AS ${lvl}
          FROM ${prev} s
        `,
      });
    } else {
      const prefix = Array.from({ length: fi }, (_, q) => `lvl_${q + 1}`);
      const pcols = prefix.map((c, q) => `${c} AS p${q + 1}`);
      const joinOn = prefix.map((c, q) => `t.p${q + 1} = b.${c}`);
      const prevLvl = `lvl_${fi}`;
      ctes.push({
        name: topName,
        sql: `
          SELECT ${prefix.map((_, q) => `p${q + 1}`).join(", ")}, value FROM (
            SELECT ${prefix.map((_, q) => `p${q + 1}`).join(", ")}, value,
              ROW_NUMBER() OVER (PARTITION BY ${prefix.map((_, q) => `p${q + 1}`).join(", ")} ORDER BY c DESC, value) AS rn
            FROM (
              SELECT ${pcols.join(", ")}, ${col} AS value, COUNT(*) AS c
              FROM ${prev}
              WHERE ${col} IS NOT NULL
                AND ${prevLvl} NOT IN (${termLit}, ${none})
              GROUP BY ${prefix.join(", ")}, ${col}
            ) agg
          ) r
          WHERE rn <= ${n}
        `,
      });
      ctes.push({
        name: chainName,
        sql: `
          SELECT b.*,
            CASE WHEN b.${prevLvl} IN (${termLit}, ${none}) THEN ${none}
                 WHEN b.${col} IS NULL THEN ${termLit}
                 WHEN t.value IS NOT NULL THEN b.${col}
                 ELSE ${other} END AS ${lvl}
          FROM ${chainName.replace(`lvl${fi + 1}`, `lvl${fi}`)} b
          LEFT JOIN ${topName} t
            ON ${joinOn.join(" AND ")} AND t.value = b.${col}
        `,
      });
    }
    prev = chainName;
  }

  return { ctes, last: prev };
}

function committedOptionCtes(
  dialect: SqlDialect,
  dataset: JourneyDataset,
  hasDimension: boolean,
): CTE[] {
  const termLit = lit(dialect, journeyTerminal(dataset.direction));
  const other = lit(dialect, JOURNEY_OTHER);
  const dimBucket = dimBucketSql(dialect, hasDimension);
  const ctes: CTE[] = [];
  for (let k = 0; k < dataset.path.length; k++) {
    const n = journeyOptionsAt(dataset.optionsPerStep, k);
    const col = `nb_${k + 1}`;
    const preds = dataset.path
      .slice(0, k)
      .map((step, i) => committedPredicate(dialect, `nb_${i + 1}`, step));
    const eligible = `__journey_commit_${k}_eligible`;
    const top = `__journey_commit_${k}_top`;
    const bucketed = `__journey_commit_${k}`;
    ctes.push({
      name: eligible,
      sql: `
        SELECT * FROM __journey_anchored
        ${preds.length ? `WHERE ${preds.join("\n          AND ")}` : ""}
      `,
    });
    ctes.push({
      name: top,
      sql: `
        SELECT value FROM (
          SELECT ${col} AS value,
            ROW_NUMBER() OVER (ORDER BY c DESC, ${col}) AS rn
          FROM (
            SELECT ${col}, COUNT(*) AS c
            FROM ${eligible}
            WHERE ${col} IS NOT NULL
            GROUP BY ${col}
          ) agg
        ) r
        WHERE rn <= ${n}
      `,
    });
    ctes.push({
      name: bucketed,
      sql: `
        SELECT
          CASE WHEN ${col} IS NULL THEN ${termLit}
               WHEN ${col} IN (SELECT value FROM ${top}) THEN ${col}
               ELSE ${other} END AS value,
          ${dimBucket} AS dim_1
        FROM ${eligible}
      `,
    });
  }
  return ctes;
}

function nullStepSql(dialect: SqlDialect, index: number): string {
  return `${dialect.castToString("NULL")} AS step_${index}`;
}

export const JOURNEY_SUPPORTED_DATASOURCE_TYPES: readonly DataSourceType[] = [
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

export function isJourneySupportedDatasourceType(
  type: DataSourceType,
): boolean {
  return JOURNEY_SUPPORTED_DATASOURCE_TYPES.includes(type);
}

export function buildJourneySql(
  config: ExplorationConfig,
  factTableMap: FactTableMap,
  dialect: SqlDialect,
): { sql: string; lookaheadDepth: number } {
  if (config.dataset.type !== "journey") {
    throw new Error("buildJourneySql called with a non-journey dataset");
  }
  const dataset = config.dataset;
  const factTable = dataset.factTableId
    ? factTableMap.get(dataset.factTableId)
    : undefined;
  const dimension = config.dimensions[0] ?? null;
  assertJourneyConfig(dataset, factTable, dimension ?? undefined);

  // validateJourneyDataset has already rejected a null unit / anchor.
  const unit = dataset.unit as string;
  const dateRange = calculateProductAnalyticsDateRange(config.dateRange);
  const timestampColumn = factTable.timestampColumn || "timestamp";
  const unitExpr = columnExpr(unit, factTable, dialect);
  const stepExpr = stepExpression(
    dataset.stepColumns,
    dataset.stepGroups,
    factTable,
    dialect,
  );
  const anchor = composeStepLabel(dataset.anchorStepValues as string[]);
  const lookaheadDepth = dataset.lookaheadDepth;
  const pathLen = dataset.path.length;
  const neighbourhoodCount = pathLen + lookaheadDepth;
  const leadOrLag = dataset.direction === "forward" ? "LEAD" : "LAG";
  const hasDimension = dimension !== null;

  const factTableGroup: FactTableGroup = {
    index: 0,
    factTable,
    metrics: [],
    units: [],
  };
  const dimensionExpr = dimension
    ? generateDimensionExpression(
        dimension,
        0,
        factTableGroup,
        dialect,
        dateRange,
      )
    : null;

  const ctes: CTE[] = [];

  const dateFilter = `${timestampColumn} >= ${dialect.toTimestamp(dateRange.startDate)} AND ${timestampColumn} <= ${dialect.toTimestamp(dateRange.endDate)}`;
  const rawCte: CTE = {
    name: "__journey_raw",
    sql: `
      SELECT * FROM (
        ${factTable.sql}
      ) t
      WHERE ${dateFilter}
    `,
  };
  ctes.push(rawCte);

  if (dimension?.dimensionType === "dynamic") {
    ctes.push(
      generateDynamicDimensionCTE(
        factTableGroup,
        dimension,
        0,
        rawCte,
        dialect,
      ),
    );
  }

  const filterParts = generateRowFilterSQL(
    dataset.rowFilters,
    factTable,
    dialect,
  );
  if (dimension?.dimensionType === "static" && dimension.values.length > 0) {
    const dimCol = columnExpr(dimension.column, factTable, dialect);
    filterParts.push(
      `${dimCol} IN (${dimension.values.map((v) => lit(dialect, v)).join(", ")})`,
    );
  }

  const eventSelects = [
    `${unitExpr} AS journey_unit`,
    `${dialect.dateTrunc(timestampColumn, "day")} AS journey_day`,
    `${timestampColumn} AS ts`,
    `${stepExpr} AS step`,
    hasDimension && dimensionExpr
      ? `${dialect.castToString(dimensionExpr)} AS dim_1`
      : `${dialect.castToString("NULL")} AS dim_1`,
  ];

  ctes.push({
    name: "__journey_events",
    sql: `
      SELECT
        ${eventSelects.join(",\n        ")}
      FROM __journey_raw
      ${filterParts.length ? `WHERE ${filterParts.join("\n        AND ")}` : ""}
    `,
  });

  // Consecutive repeats of the same step are noise in a path view (a refresh,
  // a re-render), so they always collapse.
  ctes.push({
    name: "__journey_deduped",
    sql: `
      SELECT ${JOURNEY_CARRY}
      FROM (
        SELECT ${JOURNEY_CARRY},
          LAG(step) OVER ${JOURNEY_WINDOW} AS prev_step
        FROM __journey_events
      ) d
      WHERE prev_step IS NULL OR prev_step <> step
    `,
  });

  const nbCols = Array.from(
    { length: neighbourhoodCount },
    (_, i) =>
      `${leadOrLag}(step, ${i + 1}) OVER ${JOURNEY_WINDOW} AS nb_${i + 1}`,
  );
  ctes.push({
    name: "__journey_neighbourhood",
    sql: `
      SELECT ${JOURNEY_CARRY},
        ${nbCols.join(",\n        ")}
      FROM __journey_deduped
    `,
  });

  ctes.push({
    name: "__journey_anchored",
    sql: `
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY ${JOURNEY_PARTITION} ORDER BY ts) AS rn
        FROM __journey_neighbourhood
        WHERE step = ${lit(dialect, anchor)}
      ) a
      WHERE rn = 1
    `,
  });

  let src = "__journey_anchored";
  if (pathLen > 0) {
    const preds = dataset.path.map((step, i) =>
      committedPredicate(dialect, `nb_${i + 1}`, step),
    );
    ctes.push({
      name: "__journey_matched",
      sql: `
        SELECT * FROM __journey_anchored
        WHERE ${preds.join("\n          AND ")}
      `,
    });
    src = "__journey_matched";
  }

  // Must precede every CTE that buckets dim_1 — Postgres and friends only let
  // a CTE reference siblings declared before it.
  if (hasDimension) {
    const n = dimMaxValues(dimension);
    ctes.push({
      name: "__journey_top_dim",
      sql: `
        SELECT value FROM (
          SELECT dim_1 AS value,
            ROW_NUMBER() OVER (ORDER BY c DESC, dim_1) AS rn
          FROM (
            SELECT dim_1, COUNT(*) AS c
            FROM ${src}
            WHERE dim_1 IS NOT NULL
            GROUP BY dim_1
          ) agg
        ) r
        WHERE rn <= ${n}
      `,
    });
  }

  const chain = bucketChain(dialect, dataset, src);
  ctes.push(...chain.ctes);

  if (pathLen > 0) {
    ctes.push(...committedOptionCtes(dialect, dataset, hasDimension));
  }

  const stepCount = pathLen + lookaheadDepth;
  const lvlCols = Array.from(
    { length: lookaheadDepth },
    (_, i) => `lvl_${i + 1}`,
  );
  const prefixExprs = dataset.path.map((step) => lit(dialect, step.value));
  const pathStepSelects = [
    ...prefixExprs.map((expr, i) => `${expr} AS step_${i + 1}`),
    ...lvlCols.map((col, i) => `${col} AS step_${pathLen + i + 1}`),
  ];

  // Bucket the dimension before aggregating so `(other)` collapses to one row
  // per step combination. See dimBucketSql.
  ctes.push({
    name: "__journey_path_bucketed",
    sql: `
      SELECT ${lvlCols.join(", ")},
        ${dimBucketSql(dialect, hasDimension)} AS dim_1
      FROM ${chain.last}
    `,
  });

  // Postgres/Redshift reject string literals in GROUP BY.
  const pathGroup = [...lvlCols, "dim_1"];

  const pathBranch = `
    SELECT
      ${pathStepSelects.join(",\n      ")},
      dim_1,
      COUNT(*) AS journeys
    FROM __journey_path_bucketed
    GROUP BY ${pathGroup.join(", ")}
  `;

  const branches = [pathBranch];
  if (pathLen > 0) {
    for (let k = 0; k < pathLen; k++) {
      const commitSteps = [
        ...prefixExprs.slice(0, k).map((expr, i) => `${expr} AS step_${i + 1}`),
        `value AS step_${k + 1}`,
        ...Array.from({ length: stepCount - k - 1 }, (_, i) =>
          nullStepSql(dialect, k + 2 + i),
        ),
      ];
      branches.push(`
    SELECT
      ${commitSteps.join(",\n      ")},
      dim_1,
      COUNT(*) AS journeys
    FROM __journey_commit_${k}
    GROUP BY value, dim_1
      `);
    }
  }

  const sql = format(
    `
    WITH
      ${ctes.map((c) => `${c.name} AS (\n${c.sql}\n)`).join(",\n      ")}
    ${branches.join("\n    UNION ALL\n")}
    ORDER BY journeys DESC
    `,
    dialect.formatDialect,
  );

  return { sql, lookaheadDepth };
}

export function transformJourneyRowsToResult(
  config: ExplorationConfig,
  rows: Record<string, unknown>[],
): ProductAnalyticsResult {
  if (config.dataset.type !== "journey") {
    throw new Error(
      "transformJourneyRowsToResult called with non-journey config",
    );
  }
  const pathLen = config.dataset.path.length;
  const stepCount = pathLen + config.dataset.lookaheadDepth;
  const hasDimension = config.dimensions.length > 0;
  const direction = config.dataset.direction;
  const result: ProductAnalyticsResult = { rows: [] };

  for (const row of rows) {
    const count = parseNumberValue(rowValue(row, "journeys")) ?? 0;
    const dim = parseStringValue(rowValue(row, "dim_1"));
    const steps = readStepValues(row, stepCount);
    // Trailing SQL NULL marks a prefix rollup; (none) pads a finished path.
    let lastFilled = -1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if ((steps[i] ?? null) !== null) {
        lastFilled = i;
        break;
      }
    }
    const isPathRow =
      lastFilled < 0 || steps.every((step) => (step ?? null) !== null);
    result.rows.push({
      dimensions: hasDimension ? [dim] : [],
      journey: isPathRow
        ? {
            kind: "path",
            direction,
            levels: steps.slice(pathLen).map((step) => step ?? JOURNEY_NONE),
            count,
          }
        : {
            kind: "committed",
            direction,
            stepIndex: lastFilled,
            value: steps[lastFilled] ?? JOURNEY_NONE,
            count,
          },
    });
  }

  return result;
}

function readStepValues(
  row: Record<string, unknown>,
  stepCount: number,
): (string | null)[] {
  const steps: (string | null)[] = [];
  for (let i = 0; i < stepCount; i++) {
    steps.push(parseStringValue(rowValue(row, `step_${i + 1}`)));
  }
  return steps;
}
