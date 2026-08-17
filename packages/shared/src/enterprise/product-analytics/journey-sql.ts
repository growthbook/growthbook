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
  ProductAnalyticsDynamicDimension,
  ProductAnalyticsResult,
  ProductAnalyticsResultRow,
} from "../../validators/product-analytics";
import {
  JOURNEY_NONE,
  JOURNEY_OTHER,
  composeStepLabel,
  parseJourneyOutcome,
  journeyConfigExceedsRowCap,
  journeyDimValueCount,
  journeyOptionsAt,
  journeyPathStepLabel,
  journeyTerminal,
  stepGroupsForColumn,
  MAX_JOURNEY_RESULT_ROWS,
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

function windowSpec(dailyJourneys: boolean): string {
  return dailyJourneys
    ? "(PARTITION BY journey_unit, journey_day ORDER BY ts)"
    : "(PARTITION BY journey_unit ORDER BY ts)";
}

function assertJourneyConfig(
  dataset: JourneyDataset,
  factTable: FactTableInterface | undefined,
  dimValues: number,
): asserts factTable is FactTableInterface {
  if (!dataset.factTableId) {
    throw new Error("Journey Fact Table is required");
  }
  if (!factTable) {
    throw new Error(`Fact table ${dataset.factTableId} not found`);
  }
  if (!dataset.unit) {
    throw new Error("Journey unit is required");
  }
  if (!factTable.userIdTypes.includes(dataset.unit)) {
    throw new Error(
      `Journey unit "${dataset.unit}" is not a userIdType on the Fact Table`,
    );
  }
  if (!dataset.stepColumns.length) {
    throw new Error("Journey step columns are required");
  }
  if (
    !dataset.anchorStepValues ||
    dataset.anchorStepValues.length !== dataset.stepColumns.length ||
    dataset.anchorStepValues.some((v) => !v)
  ) {
    throw new Error("Journey starting step is required");
  }
  for (const group of dataset.stepGroups ?? []) {
    if (!group.pattern) {
      throw new Error("Journey grouping rule pattern is required");
    }
    if (!dataset.stepColumns.includes(group.column)) {
      throw new Error(
        `Journey grouping rule references column "${group.column}", which is not a step column`,
      );
    }
  }
  if (dataset.path.some((step) => step.mode === "other")) {
    throw new Error("Drilling into (other) is not supported yet");
  }
  if (
    journeyConfigExceedsRowCap({
      optionsPerStep: dataset.optionsPerStep,
      depth: dataset.depth,
      pathLength: dataset.path.length,
      dimValues,
    })
  ) {
    throw new Error(
      `Journey result would exceed ${MAX_JOURNEY_RESULT_ROWS} rows. Lower options per step, steps to show, or dimension values.`,
    );
  }
}

function committedPredicate(
  dialect: SqlDialect,
  col: string,
  step: JourneyDataset["path"][number],
  index: number,
): string {
  if (step.mode === "other") {
    const excludes = step.excludes.map((v) => lit(dialect, v)).join(", ");
    return `(${col} IS NOT NULL AND ${col} NOT IN (${excludes}))   -- committed (other) at step ${index + 1}`;
  }
  return `${col} = ${lit(dialect, step.value)}   -- committed step ${index + 1}`;
}

function dimMaxValues(dimension: ProductAnalyticsDimension | null): number {
  return journeyDimValueCount(dimension ?? undefined) || 3;
}

function bucketChain(
  dialect: SqlDialect,
  dataset: JourneyDataset,
  srcCte: string,
): { ctes: CTE[]; last: string } {
  const ctes: CTE[] = [];
  const term = journeyTerminal(dataset.direction);
  const pathLen = dataset.path.length;
  const k = dataset.depth;
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
              ROW_NUMBER() OVER (ORDER BY c DESC) AS rn
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
              ROW_NUMBER() OVER (PARTITION BY ${prefix.map((_, q) => `p${q + 1}`).join(", ")} ORDER BY c DESC) AS rn
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
): CTE[] {
  const termLit = lit(dialect, journeyTerminal(dataset.direction));
  const other = lit(dialect, JOURNEY_OTHER);
  const ctes: CTE[] = [];
  for (let k = 0; k < dataset.path.length; k++) {
    const n = journeyOptionsAt(dataset.optionsPerStep, k);
    const col = `nb_${k + 1}`;
    const preds = dataset.path
      .slice(0, k)
      .map((step, i) => committedPredicate(dialect, `nb_${i + 1}`, step, i));
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
            ROW_NUMBER() OVER (ORDER BY c DESC) AS rn
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
          dim_1
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
): { sql: string; fetchDepth: number } {
  if (config.dataset.type !== "journey") {
    throw new Error("buildJourneySql called with a non-journey dataset");
  }
  const dataset = config.dataset;
  const factTable = dataset.factTableId
    ? factTableMap.get(dataset.factTableId)
    : undefined;
  const dimension = config.dimensions[0] ?? null;
  const dimValues = journeyDimValueCount(dimension ?? undefined);
  assertJourneyConfig(dataset, factTable, dimValues);

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
  // Exclusions are matched against the grouped value so that excluding
  // "/article/*" drops the whole group, matching what the user sees.
  const firstStepColExpr = groupedColumnExpr(
    dataset.stepColumns[0],
    dataset.stepGroups,
    factTable,
    dialect,
  );
  const anchor = composeStepLabel(dataset.anchorStepValues as string[]);
  const fetchDepth = dataset.depth;
  const pathLen = dataset.path.length;
  const neighbourhoodCount = pathLen + fetchDepth;
  const leadOrLag = dataset.direction === "forward" ? "LEAD" : "LAG";
  const over = windowSpec(dataset.dailyJourneys);
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
  ctes.push({
    name: "__journey_raw",
    sql: `
      SELECT * FROM (
        ${factTable.sql}
      ) t
      WHERE ${dateFilter}
    `,
  });

  if (dimension?.dimensionType === "dynamic") {
    ctes.push(
      generateDynamicDimensionCTE(
        factTableGroup,
        dimension as ProductAnalyticsDynamicDimension,
        0,
        ctes[0],
        dialect,
      ),
    );
  }

  const filterParts = generateRowFilterSQL(
    dataset.rowFilters,
    factTable,
    dialect,
  );
  if (dataset.excludedSteps.length) {
    filterParts.push(
      `${firstStepColExpr} NOT IN (${dataset.excludedSteps.map((v) => lit(dialect, v)).join(", ")})`,
    );
  }
  if (dimension?.dimensionType === "static" && dimension.values.length > 0) {
    const dimCol = columnExpr(dimension.column, factTable, dialect);
    filterParts.push(
      `${dimCol} IN (${dimension.values.map((v) => lit(dialect, v)).join(", ")})`,
    );
  }

  const eventSelects = [
    `${unitExpr} AS journey_unit`,
    ...(dataset.dailyJourneys
      ? [`${dialect.dateTrunc(timestampColumn, "day")} AS journey_day`]
      : []),
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

  let headTable = "__journey_events";
  if (dataset.collapseRepeats) {
    const carry = dataset.dailyJourneys
      ? "journey_unit, journey_day, ts, step, dim_1"
      : "journey_unit, ts, step, dim_1";
    ctes.push({
      name: "__journey_deduped",
      sql: `
        SELECT ${carry}
        FROM (
          SELECT ${carry},
            LAG(step) OVER ${over} AS prev_step
          FROM __journey_events
        ) d
        WHERE prev_step IS NULL OR prev_step <> step
      `,
    });
    headTable = "__journey_deduped";
  }

  const nbCols = Array.from(
    { length: neighbourhoodCount },
    (_, i) => `${leadOrLag}(step, ${i + 1}) OVER ${over} AS nb_${i + 1}`,
  );
  const nbCarry = dataset.dailyJourneys
    ? "journey_unit, journey_day, ts, step, dim_1"
    : "journey_unit, ts, step, dim_1";
  ctes.push({
    name: "__journey_neighbourhood",
    sql: `
      SELECT ${nbCarry},
        ${nbCols.join(",\n        ")}
      FROM ${headTable}
    `,
  });

  const anchorPartition = dataset.dailyJourneys
    ? "journey_unit, journey_day"
    : "journey_unit";
  ctes.push({
    name: "__journey_anchored",
    sql: `
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY ${anchorPartition} ORDER BY ts) AS rn
        FROM __journey_neighbourhood
        WHERE step = ${lit(dialect, anchor)}
      ) a
      WHERE rn = 1
    `,
  });

  let src = "__journey_anchored";
  if (pathLen > 0) {
    const preds = dataset.path.map((step, i) =>
      committedPredicate(dialect, `nb_${i + 1}`, step, i),
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

  const chain = bucketChain(dialect, dataset, src);
  ctes.push(...chain.ctes);

  if (pathLen > 0) {
    ctes.push(...committedOptionCtes(dialect, dataset));
  }

  if (hasDimension) {
    const n = dimMaxValues(dimension);
    ctes.push({
      name: "__journey_top_dim",
      sql: `
        SELECT value FROM (
          SELECT dim_1 AS value,
            ROW_NUMBER() OVER (ORDER BY c DESC) AS rn
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

  const dimSelect = hasDimension
    ? `CASE WHEN dim_1 IN (SELECT value FROM __journey_top_dim) THEN dim_1 ELSE ${lit(dialect, JOURNEY_OTHER)} END AS dim_1`
    : `${dialect.castToString("NULL")} AS dim_1`;

  const stepCount = pathLen + fetchDepth;
  const lvlCols = Array.from({ length: fetchDepth }, (_, i) => `lvl_${i + 1}`);
  const prefixExprs = dataset.path.map((step) =>
    lit(dialect, journeyPathStepLabel(step)),
  );
  const pathStepSelects = [
    ...prefixExprs.map((expr, i) => `${expr} AS step_${i + 1}`),
    ...lvlCols.map((col, i) => `${col} AS step_${pathLen + i + 1}`),
  ];
  // Postgres/Redshift reject string literals in GROUP BY.
  const pathGroup = [...lvlCols, "dim_1"];

  const pathBranch = `
    SELECT
      ${pathStepSelects.join(",\n      ")},
      ${dimSelect},
      COUNT(*) AS journeys
    FROM ${chain.last}
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
      const commitGroup = hasDimension ? ["value", "dim_1"] : ["value"];
      branches.push(`
    SELECT
      ${commitSteps.join(",\n      ")},
      ${dimSelect},
      COUNT(*) AS journeys
    FROM __journey_commit_${k}
    GROUP BY ${commitGroup.join(", ")}
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

  return { sql, fetchDepth };
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
  const fetchDepth = config.dataset.depth;
  const pathLen = config.dataset.path.length;
  const stepCount = pathLen + fetchDepth;
  const hasDimension = config.dimensions.length > 0;
  const direction = config.dataset.direction;
  const result: ProductAnalyticsResult = { rows: [] };

  for (const row of rows) {
    const count = parseNumberValue(rowValue(row, "journeys")) ?? 0;
    const dim = parseStringValue(rowValue(row, "dim_1"));
    const resultRow: ProductAnalyticsResultRow = {
      dimensions: hasDimension ? [dim] : [],
    };
    const steps = readStepValues(row, stepCount);
    if (steps) {
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
      if (isPathRow) {
        const lookahead = steps.slice(pathLen);
        resultRow.journey = {
          kind: "path",
          direction,
          levels: lookahead.map((step) => step ?? JOURNEY_NONE),
          count,
        };
      } else {
        resultRow.journey = {
          kind: "committed",
          direction,
          stepIndex: lastFilled,
          value: steps[lastFilled] ?? JOURNEY_NONE,
          count,
        };
      }
    } else {
      resultRow.journey = legacyJourneyFromRow(
        row,
        fetchDepth,
        direction,
        count,
      );
    }
    result.rows.push(resultRow);
  }

  return result;
}

function readStepValues(
  row: Record<string, unknown>,
  stepCount: number,
): (string | null)[] | null {
  if (rowValue(row, "step_1") === undefined) return null;
  const steps: (string | null)[] = [];
  for (let i = 0; i < stepCount; i++) {
    steps.push(parseStringValue(rowValue(row, `step_${i + 1}`)));
  }
  return steps;
}

function legacyJourneyFromRow(
  row: Record<string, unknown>,
  fetchDepth: number,
  direction: "forward" | "backward",
  count: number,
): NonNullable<ProductAnalyticsResultRow["journey"]> {
  const kind = parseStringValue(rowValue(row, "kind"));
  if (kind === "progress") {
    return {
      kind: "progress",
      direction,
      depthReached: parseNumberValue(rowValue(row, "lvl_1")) ?? 0,
      outcome: parseJourneyOutcome(parseStringValue(rowValue(row, "lvl_2"))),
      count,
    };
  }
  if (kind === "committed") {
    return {
      kind: "committed",
      direction,
      stepIndex: parseNumberValue(rowValue(row, "lvl_1")) ?? 0,
      value: parseStringValue(rowValue(row, "lvl_2")) ?? JOURNEY_NONE,
      count,
    };
  }
  const levels: string[] = [];
  for (let i = 0; i < fetchDepth; i++) {
    levels.push(
      parseStringValue(rowValue(row, `lvl_${i + 1}`)) ?? JOURNEY_NONE,
    );
  }
  return {
    kind: "path",
    direction,
    levels,
    count,
  };
}
