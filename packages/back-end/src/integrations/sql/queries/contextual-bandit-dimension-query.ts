import { format } from "shared/sql";
import type { SqlDialect } from "shared/types/sql";
import type {
  ContextualBanditDimensionSqlAttribute,
  ContextualBanditDimensionSqlParams,
  ContextualBanditQuantileBucketEdgesSqlParams,
  ContextualBanditTopValuesSqlParams,
} from "shared/types/integrations";

const DEFAULT_METRIC_VALUE_COLUMN = "main_metric";
const DEFAULT_VARIATION_ID_COLUMN = "variation_id";

function assertSimpleIdentifier(identifier: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid contextual bandit column: ${identifier}`);
  }
}

function sqlString(dialect: SqlDialect, value: string): string {
  return `'${dialect.escapeStringLiteral(value)}'`;
}

function numericLiteral(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid contextual bandit bucket edge: ${value}`);
  }
  return `${value}`;
}

function attrColumn(attribute: string): string {
  assertSimpleIdentifier(attribute);
  return `__cbaq.${attribute}`;
}

function aliasForIndex(index: number): string {
  return `ctx_${index}`;
}

function contextLabelExpression(
  dialect: SqlDialect,
  attributes: ContextualBanditDimensionSqlAttribute[],
  tableAlias: string,
): string {
  const parts = attributes.flatMap((attribute, index) => {
    const prefix = `${attribute.attribute}=`;
    const separator = index === attributes.length - 1 ? "" : "|";
    const alias = `${tableAlias}.${aliasForIndex(index)}`;
    return [
      sqlString(dialect, prefix),
      `COALESCE(${alias}, ${sqlString(dialect, "__null__")})`,
      sqlString(dialect, separator),
    ];
  });

  return `CONCAT(${parts.join(", ")})`;
}

export function getContextualBanditCaseWhen(
  dialect: SqlDialect,
  attribute: ContextualBanditDimensionSqlAttribute,
): string {
  const column = attrColumn(attribute.attribute);
  const stringColumn = dialect.castToString(column);

  if (attribute.kind === "categorical") {
    const topValues = attribute.topValues ?? [];
    if (!topValues.length) {
      return `COALESCE(${stringColumn}, ${sqlString(dialect, "__null__")})`;
    }

    const topValueSql = topValues.map((v) => sqlString(dialect, v)).join(", ");
    return `CASE
      WHEN ${column} IS NULL THEN ${sqlString(dialect, "__null__")}
      WHEN ${stringColumn} IN (${topValueSql}) THEN ${stringColumn}
      ELSE ${sqlString(dialect, "other")}
    END`;
  }

  const bucketEdges = attribute.bucketEdges ?? [];
  if (bucketEdges.length < 2) {
    return `COALESCE(${stringColumn}, ${sqlString(dialect, "__null__")})`;
  }

  const floatColumn = dialect.castToFloat(column);
  const cases = bucketEdges.slice(1).map((edge, index) => {
    const lower = bucketEdges[index];
    const isLast = index === bucketEdges.length - 2;
    const label = isLast ? `[${lower},${edge}]` : `[${lower},${edge})`;
    const condition = isLast
      ? `${floatColumn} <= ${numericLiteral(edge)}`
      : `${floatColumn} < ${numericLiteral(edge)}`;

    return `WHEN ${condition} THEN ${sqlString(dialect, label)}`;
  });

  return `CASE
      WHEN ${column} IS NULL THEN ${sqlString(dialect, "__null__")}
      ${cases.join("\n      ")}
      ELSE ${sqlString(dialect, "other")}
    END`;
}

export function getContextualBanditDimensionSql(
  dialect: SqlDialect,
  {
    query,
    userIdColumn,
    variationIdColumn = DEFAULT_VARIATION_ID_COLUMN,
    metricValueColumn = DEFAULT_METRIC_VALUE_COLUMN,
    attributes,
    maxContexts,
  }: ContextualBanditDimensionSqlParams,
): string {
  if (!attributes.length) {
    throw new Error("At least one contextual bandit attribute is required");
  }
  if (maxContexts < 1) {
    throw new Error("maxContexts must be positive");
  }

  assertSimpleIdentifier(userIdColumn);
  assertSimpleIdentifier(variationIdColumn);
  assertSimpleIdentifier(metricValueColumn);
  attributes.forEach((attribute) =>
    assertSimpleIdentifier(attribute.attribute),
  );

  const contextAliases = attributes.map((_, index) => aliasForIndex(index));
  const contextSelect = attributes
    .map(
      (attribute, index) =>
        `${getContextualBanditCaseWhen(dialect, attribute)} AS ${aliasForIndex(
          index,
        )}`,
    )
    .join(",\n    ");
  const contextGroupBy = contextAliases.join(", ");
  const contextJoin = contextAliases
    .map((alias) => `raw.${alias} = top_ctx.${alias}`)
    .join(" AND ");
  const topContextId = contextLabelExpression(dialect, attributes, "ranked");

  return format(
    `
WITH raw AS (
  SELECT
    ${dialect.castToString(`__cbaq.${userIdColumn}`)} AS user_id,
    ${dialect.castToString(`__cbaq.${variationIdColumn}`)} AS variation_id,
    ${dialect.castToFloat(`__cbaq.${metricValueColumn}`)} AS main_metric,
    ${contextSelect}
  FROM (
    ${query}
  ) __cbaq
  WHERE __cbaq.${userIdColumn} IS NOT NULL
    AND __cbaq.${variationIdColumn} IS NOT NULL
),
ctx_counts AS (
  SELECT
    ${contextGroupBy},
    COUNT(*) AS n
  FROM raw
  GROUP BY ${contextGroupBy}
),
top_ctx AS (
  SELECT
    ${contextGroupBy},
    ${topContextId} AS context_id
  FROM (
    SELECT
      ${contextGroupBy},
      n,
      ROW_NUMBER() OVER (ORDER BY n DESC, ${contextGroupBy}) AS row_num
    FROM ctx_counts
  ) ranked
  WHERE row_num <= ${maxContexts}
),
labeled AS (
  SELECT
    raw.variation_id,
    COALESCE(top_ctx.context_id, ${sqlString(dialect, "other")}) AS context_id,
    raw.main_metric
  FROM raw
  LEFT JOIN top_ctx ON ${contextJoin}
)
SELECT
  variation_id AS variation,
  context_id,
  SUM(main_metric) AS main_sum,
  SUM(main_metric * main_metric) AS main_sum_squares,
  COUNT(*) AS n
FROM labeled
GROUP BY variation_id, context_id
ORDER BY variation, context_id
`,
    dialect.formatDialect,
  );
}

export function getContextualBanditTopValuesQuery(
  dialect: SqlDialect,
  { query, attribute, limit }: ContextualBanditTopValuesSqlParams,
): string {
  assertSimpleIdentifier(attribute);
  if (limit < 1) {
    throw new Error("limit must be positive");
  }

  const column = attrColumn(attribute);
  const value = dialect.castToString(column);

  return format(
    `
WITH __cbaq AS (
  ${query}
)
SELECT
  ${value} AS value,
  COUNT(*) AS count
FROM __cbaq
WHERE ${column} IS NOT NULL
GROUP BY ${value}
ORDER BY count DESC, value
LIMIT ${limit}
`,
    dialect.formatDialect,
  );
}

export function getContextualBanditQuantileBucketEdgesQuery(
  dialect: SqlDialect,
  { query, attribute, buckets }: ContextualBanditQuantileBucketEdgesSqlParams,
): string {
  assertSimpleIdentifier(attribute);
  if (buckets < 1) {
    throw new Error("buckets must be positive");
  }

  const column = dialect.castToFloat(attrColumn(attribute));
  const quantileSelects = Array.from({ length: buckets + 1 }, (_, index) => {
    if (index === 0) return `MIN(${column}) AS q0`;
    if (index === buckets) return `MAX(${column}) AS q${index}`;
    return `${dialect.percentileApprox(column, index / buckets)} AS q${index}`;
  }).join(",\n  ");

  return format(
    `
WITH __cbaq AS (
  ${query}
)
SELECT
  ${quantileSelects}
FROM __cbaq
WHERE ${attrColumn(attribute)} IS NOT NULL
`,
    dialect.formatDialect,
  );
}
